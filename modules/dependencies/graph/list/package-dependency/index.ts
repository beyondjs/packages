import type { DependenciesNode } from '../../node';
import type { Registries } from '@beyond-js/packages/repositories/registries';
import { Groups } from './groups';
import { RepositoriesErrorManager } from '@beyond-js/packages/repositories/errors';

export class PackageDependency {
	#registries: Registries;

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

	#error: RepositoriesErrorManager;
	get error() {
		return this.#error;
	}

	constructor(registries: Registries, pkg: string) {
		this.#registries = registries;
		this.#pkg = pkg;
	}

	async initialize() {
		if (this.#initialized) return;
		const response = await this.#registries.npm.versions(this.#pkg);
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
