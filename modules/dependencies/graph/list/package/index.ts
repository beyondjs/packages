import type { DependenciesNode } from '../../node';
import type { Providers } from '@beyond-js/packages/providers';
import { Groups } from './groups';
import { ProvidersErrorManager } from '@beyond-js/packages/providers/errors';
import { DependencyInfo, InfoIsType } from '@beyond-js/packages/dependencies/info';

export class DependencyPackage {
	#providers: Providers;

	#info: DependencyInfo;
	get info() {
		return this.#info;
	}

	#versions?: string[];
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

	#error: ProvidersErrorManager;
	get error() {
		return this.#error;
	}

	constructor(providers: Providers, info: DependencyInfo) {
		this.#providers = providers;
		this.#info = info;
	}

	async initialize() {
		if (this.#initialized) return;

		console.log(
			'Initializing dependency package:',
			this.#info.package,
			this.#info.version,
			this.#info.data.is,
			this.#info.data.is !== InfoIsType.Semver
		);

		// Only semver packages have versions and groups
		if (this.#info.data.is !== InfoIsType.Semver) return;

		// Retrieve the versions of the package
		const { error, versions } = await this.#providers.semver.versions(this.#info.package);
		if (error) {
			this.#initialized = true;
			this.#error = error;
			return;
		}

		this.#versions = versions;
		this.#groups = new Groups(versions);
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
