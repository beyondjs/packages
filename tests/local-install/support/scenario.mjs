/**
 * What one group of acceptance tests works on: a layout with copies of the workspace, the repository holding the
 * member outside it and the second project; a fixture registry on an allocated port; the transport that records
 * every request; and, for each project, the same source store and metadata cache, which are directories of the
 * layout outside every project.
 *
 * Usage, under `node:test`:
 *
 *     const scenario = new Scenario('install');
 *     before(() => scenario.open());
 *     after(() => scenario.close());
 */
import { Layout } from './layout.mjs';
import { Catalog } from './catalog.mjs';
import { Recorder } from './transport.mjs';
import { Project } from './project.mjs';

export class Scenario {
	#label;
	#layout;
	#registry;
	#recorder = new Recorder();

	/**
	 * The temporary copies of the fixtures
	 */
	get layout() {
		return this.#layout;
	}

	/**
	 * The fixture registry: its `log` and `requests` count what it received
	 */
	get registry() {
		return this.#registry;
	}

	/**
	 * The transport of every installation of the scenario
	 */
	get recorder() {
		return this.#recorder;
	}

	/**
	 * Where every project of the scenario keeps its sources and its metadata
	 */
	get store() {
		return this.#layout.path('store');
	}

	get metadata() {
		return this.#layout.path('metadata');
	}

	/**
	 * The workspace with its members inside and outside the root
	 */
	get workspace() {
		return this.project('workspace');
	}

	/**
	 * @param {string} label Names the layout of the scenario
	 */
	constructor(label) {
		this.#label = label;
	}

	/**
	 * Copies the fixture groups and starts the registry with the given release sets
	 */
	async open({ sets = ['initial'], groups = ['workspace', 'repositories', 'second'] } = {}) {
		this.#layout = new Layout(this.#label);
		groups.forEach(group => this.#layout.copy(group));
		this.#registry = await Catalog.registry(sets);
		return this;
	}

	/**
	 * A project of the layout with the scenario's store, metadata, registry and transport
	 *
	 * @param {string} directory Relative to the layout
	 * @param {object} [settings] Replaces any of them
	 */
	project(directory, settings = {}) {
		return new Project(this.#layout.path(directory), {
			store: this.store,
			metadata: this.metadata,
			registry: this.#registry.url,
			transport: this.#recorder,
			...settings
		});
	}

	/**
	 * Publishes another release set, such as a newer React after the first installation
	 */
	publish(set) {
		return Catalog.publish(this.#registry, set);
	}

	/**
	 * Forgets the requests seen so far, by the registry and by the transport
	 */
	reset() {
		this.#registry.reset();
		this.#recorder.reset();
	}

	/**
	 * Stops the registry and removes the layout, store and metadata cache included
	 */
	async close() {
		await this.#registry?.stop();
		this.#layout?.remove();
	}
}
