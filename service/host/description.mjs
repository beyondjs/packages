import { pathToFileURL } from 'node:url';
import { isAbsolute, join, relative, sep } from 'node:path';
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
		const published = await this.#delivery.published();
		const counts = new Map();
		published.forEach(({ specifier }) => counts.set(specifier, (counts.get(specifier) ?? 0) + 1));

		const modules = {};
		for (const { specifier, vspecifier, name, version, subpath, path } of published) {
			// Several local versions publish one specifier: a Node consumer resolves no version for it (it would
			// take one of them for every importer), and each one is described by its versioned identity
			const key = counts.get(specifier) > 1 ? vspecifier : specifier;
			modules[key] = {
				package: name,
				vspecifier,
				path: ModulePath.format(new Identity({ name, version, subpath })),
				base: pathToFileURL(join(path, 'package.json')).href
			};
		}

		const { root, standalone, toolchain, versions, extensions = [] } = this.#settings;
		return {
			protocol: Session.PROTOCOL,
			contract: Schema.version,
			workspace: { root, standalone },
			service: { pid: process.ppid, toolchain, versions, origin: this.#origin, extensions },
			options: this.#options.query,
			runtime: this.#runtime(),
			revision: this.#revision,
			modules
		};
	}

	/**
	 * What a Node consumer resolves from the toolchain installation: what the served generation is made of says it
	 * (`Composition.runtime`). With an installed graph it is the toolchain's own runtime alone, and only when the
	 * graph does not provide it (D10): the consumer fails to resolve anything else rather than receive a copy that
	 * is not the one the graph selected.
	 */
	#runtime() {
		return this.#delivery.composition?.runtime ?? this.#settings.runtime;
	}

	/**
	 * Builds a module for Node consumers, or for browsers when it does not declare Node: a module that only
	 * runs in a browser is valid, and describing it as one that does not build would misreport the workspace
	 */
	async #built(module) {
		const built = await this.#delivery.module(module, this.conditions);
		const undeclared = built.failure?.diagnostics?.length && built.failure.diagnostics.every(({ code }) => code === 'CONDITIONAL_NOT_FOUND');
		if (!undeclared) return built;

		return this.#delivery.module(module, { ...this.conditions, platform: 'web' });
	}

	/**
	 * Builds every public module and reports which ones are valid. A workspace with diagnostics is still
	 * served: this is how a client sees what has to be corrected.
	 */
	async state() {
		const modules = [];
		for (const module of await this.#delivery.published()) {
			const { delivered, failure } = await this.#built(module);
			const { specifier, vspecifier } = module;

			if (delivered && this.#hashes.get(vspecifier) !== delivered.hash) {
				this.#hashes.set(vspecifier, delivered.hash);
				this.#revision++;
			}
			modules.push(
				delivered
					? { specifier, vspecifier, status: 'valid', hash: delivered.hash }
					: { specifier, vspecifier, status: 'invalid', code: failure.code, diagnostics: this.#located(failure.diagnostics ?? []) }
			);
		}

		const diagnostics = [...this.#declared(), ...this.#located(await this.#delivery.diagnostics())];
		const projection = this.#delivery.projection;
		const installation = projection && { state: projection.state, diagnostics: projection.diagnostics };
		const packages = (await this.#delivery.provenance?.()) ?? [];
		return { revision: this.#revision, diagnostics, modules, ...(installation ? { installation } : {}), packages };
	}

	/**
	 * The diagnostics of the declaration of the workspace, with the paths they name inside the root relative
	 * to it
	 */
	#declared() {
		const diagnostics = this.#delivery.declared?.diagnostics ?? [];
		return diagnostics.map(({ code, message, severity, paths }) => ({
			code,
			message,
			severity,
			...(paths ? { paths: paths.map(path => this.#relative(path) ?? path) } : {})
		}));
	}

	/**
	 * A path inside the served root, relative to it with forward slashes; undefined outside it
	 */
	#relative(file) {
		const root = this.#settings.root;
		const path = typeof file === 'string' && root ? relative(root, file) : '';
		if (!path || path.startsWith('..') || isAbsolute(path)) return;
		return path.split(sep).join('/');
	}

	/**
	 * The diagnostics as the state names them: a file inside the served root is named relative to it, with
	 * its one-based position as `range`; a file outside the root, or none, leaves the message alone
	 */
	#located(diagnostics) {
		return diagnostics.map(({ code, message, file, position }) => {
			const located = { code, message };
			const path = this.#relative(file);
			if (!path) return located;
			located.file = path;
			position && (located.range = { line: position.line, column: position.column });
			return located;
		});
	}
}
