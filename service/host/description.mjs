import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { Identity, ModulePath, Options, Schema, Session } from '@beyond-js/artifact-api';

/**
 * What the service says about itself and about the workspace it serves: the session description that
 * loaders and commands read, and the build state of every public module.
 */
export class Description {
	#settings;
	#delivery;
	#origin;
	#options = new Options(Options.development);

	// The hash last observed for each module, which is what makes the revision advance
	#hashes = new Map();
	#revision = 0;

	/**
	 * The conditions of the modules this service delivers to Node consumers
	 */
	get conditions() {
		return this.#options.conditions;
	}

	/**
	 * @param {object} settings The settings the supervisor gave the host
	 * @param {object} delivery The Delivery of the workspace
	 */
	constructor(settings, delivery) {
		this.#settings = settings;
		this.#delivery = delivery;
	}

	set origin(value) {
		this.#origin = value;
	}

	/**
	 * The session description of the contract (`GET /session`)
	 */
	async session() {
		const modules = {};
		for (const { specifier, vspecifier, name, version, subpath, path } of await this.#delivery.published()) {
			modules[specifier] = {
				package: name,
				vspecifier,
				path: ModulePath.format(new Identity({ name, version, subpath })),
				base: pathToFileURL(join(path, 'package.json')).href
			};
		}

		const { root, standalone, toolchain, versions, runtime } = this.#settings;
		return {
			protocol: Session.PROTOCOL,
			contract: Schema.version,
			workspace: { root, standalone },
			service: { pid: process.ppid, toolchain, versions, origin: this.#origin },
			options: this.#options.query,
			runtime,
			revision: this.#revision,
			modules
		};
	}

	/**
	 * Builds every public module and reports which ones are valid. A workspace with diagnostics is still
	 * served: this is how a client sees what has to be corrected.
	 */
	async state() {
		const modules = [];
		for (const module of await this.#delivery.published()) {
			const { delivered, failure } = await this.#delivery.module(module, this.conditions);
			const { specifier, vspecifier } = module;

			if (delivered && this.#hashes.get(vspecifier) !== delivered.hash) {
				this.#hashes.set(vspecifier, delivered.hash);
				this.#revision++;
			}
			modules.push(
				delivered
					? { specifier, vspecifier, status: 'valid', hash: delivered.hash }
					: { specifier, vspecifier, status: 'invalid', code: failure.code, diagnostics: failure.diagnostics ?? [] }
			);
		}

		return { revision: this.#revision, diagnostics: await this.#delivery.diagnostics(), modules };
	}
}
