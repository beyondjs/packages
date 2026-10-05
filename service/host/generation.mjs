import { Workspace } from '@beyond-js/packages/workspace';
import { Delivery } from '@beyond-js/packages/artifacts';
import { Execution } from '@beyond-js/packages/execution';
import { Declaration } from '../workspace/declaration.mjs';
import { Composition } from './composition.mjs';
import { Provenance } from './provenance.mjs';

/**
 * One generation of the hosted workspace: what the declaration and the installed graph said when it was created,
 * the Packages workspace built from them and the delivery of its artifacts.
 *
 * The declaration is read at once; the projection of the installed graph is read with the current inputs and member
 * directories of the declaration, so a projection built for other manifests, or for members elsewhere, is known as
 * stale. The workspace is created from both
 * (see `Composition`), and the generation is ready when the workspace is. A generation destroyed before its
 * workspace exists never creates one.
 */
export class Generation {
	#settings;
	#declaration;
	#projection;
	#composition;
	#workspace;
	#delivery;
	#provenance;
	#ready;
	#destroyed = false;

	/**
	 * The declaration of the workspace this generation was created from
	 */
	get declaration() {
		return this.#declaration;
	}

	/**
	 * The projection of the installed graph as it was read: `{state, diagnostics, execution?}`
	 */
	get projection() {
		return this.#projection;
	}

	/**
	 * What the workspace of this generation is made of
	 */
	get composition() {
		return this.#composition;
	}

	/**
	 * The delivery of the artifacts of this generation's workspace, once it is ready
	 */
	get delivery() {
		return this.#delivery;
	}

	/**
	 * Resolves once the workspace of this generation was read; rejects with what made reading it fail
	 */
	get ready() {
		return this.#ready;
	}

	/**
	 * @param {{root: string, supplied?: {name: string, path: string}[], runtime?: object}} settings The settings of
	 * the host: the canonical root, the packages the toolchain supplies and the runtime of the session
	 */
	constructor(settings) {
		this.#settings = settings;
		this.#declaration = Declaration.read(settings.root);
		this.#ready = this.#load();
	}

	async #load() {
		const { root, supplied, runtime } = this.#settings;
		this.#projection = await Execution.read(root, Composition.current(this.#declaration));
		if (this.#destroyed) return;

		this.#composition = new Composition(this.#declaration, this.#projection, { supplied, runtime });
		this.#workspace = new Workspace(root, this.#composition.options);
		this.#delivery = new Delivery(this.#workspace);
		this.#provenance = new Provenance(this.#workspace, this.#composition);
		await this.#workspace.ready;
	}

	/**
	 * Where every package this generation serves comes from
	 */
	provenance() {
		return this.#provenance.list();
	}

	/**
	 * Releases the workspace of this generation and its watchers; a generation destroyed before its workspace
	 * exists never creates one
	 */
	destroy() {
		this.#destroyed = true;
		this.#workspace?.destroy();
	}
}
