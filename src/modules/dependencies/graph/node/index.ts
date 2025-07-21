import type { ErrorManager } from '@beyond-js/response/main';
import type { Registries } from '@beyond-js/packages/repositories/registries';
import type { DependenciesList } from '../list';
import { NodeDependencies } from './dependencies';
import { Version } from './version';
import { DependenciesSpecs } from '@beyond-js/packages/dependencies/specs';

export class DependenciesNode {
	#registries: Registries;
	#list: DependenciesList;

	#pkg: string;
	get pkg() {
		return this.#pkg;
	}

	#version: Version;
	get version() {
		return this.#version;
	}

	#parent?: DependenciesNode;
	get parent() {
		return this.#parent;
	}

	#dependencies;
	get dependencies() {
		return this.#dependencies;
	}

	#processing = false;
	get processing() {
		return this.#processing;
	}

	#processed = false;
	get processed() {
		return this.#processed;
	}

	#error: ErrorManager;
	get error() {
		return this.#error;
	}

	constructor(
		registries: Registries,
		list: DependenciesList,
		pkg: string,
		version: string,
		parent?: DependenciesNode
	) {
		this.#registries = registries;
		this.#list = list;
		this.#pkg = pkg;
		this.#parent = parent;
		this.#version = new Version(version);
		this.#dependencies = new NodeDependencies(this, list);

		this.#version.on('change', this.invalidate.bind(this));
	}

	invalidate() {
		if (!this.#processed) return;

		this.#processed = false;
		this.#dependencies.invalidate();
	}

	async register() {
		await this.#list.register(this);
	}

	/**
	 * Fetches the package dependencies and processes them.
	 * If the node is already processed or being processed, it throws an error.
	 * @returns
	 */
	async process(): Promise<void> {
		if (this.#processing || this.#processed) {
			throw new Error('Node is already processed or it is being processed');
		}
		this.#processing = true;
		this.#error = void 0;

		const done = ({ error }: { error?: ErrorManager }) => {
			this.#error = error;
			this.#processing = false;
			this.#processed = true;
		};

		const version = this.#version;
		if (version.error) return done({ error: version.error });

		const spec = await this.#registries.npm.spec(this.#pkg, this.#version.resolved);
		if (spec.error) return done({ error: spec.error });

		const dependencies = new DependenciesSpecs(spec.data.value);
		await this.#dependencies.process(dependencies);
		return done({});
	}

	async reprocess() {
		if (this.#processing) {
			throw new Error('Node is already being processed');
		}

		if (!this.#processed) {
			await this.process();
			return;
		}

		this.#processing = true;
		await this.#dependencies.reprocess();
		this.#processing = false;
	}
}
