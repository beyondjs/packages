import type { Providers } from '@beyond-js/packages/providers';
import { ProvidersErrorManager } from '@beyond-js/packages/providers/errors';
import { DependencyInfo, InfoIsType } from '@beyond-js/packages/providers/dependency/info';
import { PendingPromise } from '@beyond-js/pending-promise/main';
import { PackageNodes } from './nodes';

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

	#nodes: PackageNodes;
	get nodes() {
		return this.#nodes;
	}

	#initialized = false;
	get initialized() {
		return this.#initialized;
	}

	#error: ProvidersErrorManager;
	get error() {
		return this.#error;
	}

	#ready: PendingPromise<void>;
	get ready() {
		if (this.#ready) return this.#ready;
		this.#ready = new PendingPromise<void>();
		this.#initialize().then(() => this.#ready.resolve());

		return this.#ready;
	}

	constructor(providers: Providers, info: DependencyInfo) {
		this.#providers = providers;
		this.#info = info;
	}

	async #initialize() {
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
		const { error, versions } = await this.#providers.semver.versions(this.#info);
		if (error) {
			this.#initialized = true;
			this.#error = error;
			return;
		}

		this.#versions = versions;
		this.#nodes = new PackageNodes(this, versions);
		this.#initialized = true;
	}
}
