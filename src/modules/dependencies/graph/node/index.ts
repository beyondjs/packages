import type { ErrorManager } from '@beyond-js/response/main';
import type { DependenciesList } from '../list';
import { NodeDependencies } from './dependencies';
import { Version } from './version';
import { NPM } from '@beyond-js/cdn/business/packages/registry';
import { DependenciesSpecs } from '@beyond-js/cdn/business/dependencies/specs';

export class DependenciesNode {
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

	constructor(list: DependenciesList, pkg: string, version: string, parent?: DependenciesNode) {
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

	async process() {
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

		const specs = await NPM.specs(this.#pkg, this.#version.resolved);
		if (specs.error) return done({ error: specs.error });

		const dependencies = new DependenciesSpecs(specs.value);
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
