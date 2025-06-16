import type { DependenciesNode } from '../../node';
import { Groups } from './groups';
import { NPM } from '@beyond-js/cdn/business/packages/registry';
import { BusinessErrorManager } from '@beyond-js/cdn/business/errors';

export class PackageDependency {
	#pkg: string;
	get pkg() {
		return this.#pkg;
	}

	#versions: string[];
	get versions() {
		return this.#versions;
	}

	#groups: Groups;
	get groups() {
		return this.#groups;
	}

	#initialized = false;
	get initialized() {
		return this.#initialized;
	}

	#error: BusinessErrorManager;
	get error() {
		return this.#error;
	}

	constructor(pkg: string) {
		this.#pkg = pkg;
	}

	async initialize() {
		if (this.#initialized) return;
		const response = await NPM.versions(this.#pkg);
		if (response.error) {
			this.#initialized = true;
			this.#error = response.error;
			return;
		}

		this.#versions = response.data;
		this.#groups = new Groups(response.data);
		this.#initialized = true;
	}

	register(node: DependenciesNode) {
		if (!this.#initialized) throw new Error('Dependency not initialized');
		if (this.#error) throw new Error('Dependency is invalid. Check the .error property');

		return this.#groups.register(node);
	}

	unregister(node: DependenciesNode) {
		return this.#groups.unregister(node);
	}
}
