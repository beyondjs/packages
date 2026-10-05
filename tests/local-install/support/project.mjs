/**
 * A workspace (or a standalone package) of the acceptance, installed through the public contracts exactly as the
 * development service installs one: the declaration read from disk gives the members, their inputs and the root
 * manifest to an `Installation`, together with the source store, the metadata cache, the registry settings and the
 * transport of the test. The settings name only the fixture registry and never read the rc files or the
 * environment of whoever runs the test.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Installation } from '@beyond-js/packages/installation';
import { Execution } from '@beyond-js/packages/execution';
import { Declaration } from '../../../service/workspace/declaration.mjs';
import { Graph } from './graph.mjs';

export class Project {
	/**
	 * Where the lock and the execution projection are written, relative to the root
	 */
	static LOCK = 'beyond-lock.json';
	static PROJECTION = join('.beyond', 'execution.json');

	#root;
	#settings;

	/**
	 * The canonical root of the workspace or package
	 */
	get root() {
		return this.#root;
	}

	/**
	 * @param {string} root Canonical root
	 * @param {{store: string, metadata: string, registry: string, transport?: {fetch: Function}}} settings
	 */
	constructor(root, settings) {
		this.#root = root;
		this.#settings = settings;
	}

	/**
	 * An absolute path inside the root
	 */
	path(...segments) {
		return join(this.#root, ...segments);
	}

	/**
	 * The declaration as it is on disk now
	 */
	declaration() {
		return Declaration.read(this.#root);
	}

	/**
	 * The installation of what the declaration says now. An invalid declaration fails the call, as the service
	 * refuses it (`DECLARATION_INVALID`) before any installation exists.
	 *
	 * @param {object} [settings] Replaces settings of this project (`store`, `metadata`, `registry`, `values`: the
	 *   provider values in full, when a test needs more than the default registry)
	 */
	installation(settings = {}) {
		const declaration = this.declaration();
		if (!declaration.valid) throw new Error(`Invalid declaration: ${JSON.stringify(declaration.diagnostics)}`);

		const { store, metadata, registry, values, transport } = { ...this.#settings, ...settings };
		return new Installation({
			root: declaration.root,
			members: declaration.members,
			inputs: declaration.inputs,
			manifest: declaration.kind === 'standalone' ? undefined : declaration.manifest,
			store,
			metadata,
			providers: { values: values ?? { default: { registry } }, user: false, global: false, env: false },
			transport: transport?.fetch
		});
	}

	/**
	 * Installs what the declaration says now, with a new installation
	 *
	 * @param {{update?: boolean, offline?: boolean}} [options]
	 * @param {object} [settings] As `installation()` takes them
	 */
	install(options, settings) {
		return this.installation(settings).install(options);
	}

	/**
	 * The projection as a consumer reads it, judged against the inputs the declaration has now
	 */
	read() {
		return Execution.read(this.#root, { inputs: this.declaration().inputs });
	}

	/**
	 * The text of the lock and of the projection, null when absent: what "nothing written" compares
	 */
	files() {
		const text = path => (existsSync(path) ? readFileSync(path, 'utf8') : null);
		return { lock: text(this.path(Project.LOCK)), projection: text(this.path(Project.PROJECTION)) };
	}

	/**
	 * The lock as written: its text, its document and a reader of its graph
	 */
	lock() {
		const { lock: text } = this.files();
		if (text === null) throw new Error(`No lock at ${this.path(Project.LOCK)}`);
		const document = JSON.parse(text);
		return { text, document, graph: new Graph(document) };
	}
}
