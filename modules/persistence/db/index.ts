import { PendingPromise } from '@beyond-js/pending-promise/main';
import type { Packages, Conditionals, Releases, InstalledPackages } from '@beyond-js/packages/persistence/types';
import type { Projects } from '@beyond-js/packages/persistence/types/cdn';

declare const bimport: (module: string) => Promise<any>;

export /*bundle*/ const db = new (class DB {
	#ready: PendingPromise<void>;
	#initialised = false;

	#env: string;
	get env() {
		return this.#env;
	}

	#check() {
		if (!this.#initialised) throw new Error('Database not initialised. Call the init method first.');
	}

	/**
	 * Only available when server is running in CDN environment
	 */
	#projects?: Projects;
	get projects() {
		this.#check();
		return this.#projects;
	}

	#packages: Packages;
	get packages() {
		this.#check();
		return this.#packages;
	}

	#releases: Releases;
	get releases() {
		this.#check();
		return this.#releases;
	}

	#installed: InstalledPackages;
	get installed() {
		this.#check();
		return this.#installed;
	}

	#conditionals: Conditionals;
	get conditionals() {
		this.#check();
		return this.#conditionals;
	}

	async init(options: { cdn?: boolean }): Promise<void> {
		if (this.#ready) return await this.#ready;
		this.#ready = new PendingPromise<void>();

		const env = options.cdn ? 'cdn' : 'local';
		const db = await bimport(`@beyond-js/packages/persistence/${env}/db`);
		const { projects, packages, releases, installed, conditionals } = db;

		this.#env = env;
		this.#projects = projects;
		this.#packages = packages;
		this.#releases = releases;
		this.#installed = installed;
		this.#conditionals = conditionals;
		this.#ready.resolve();

		this.#initialised = true;
	}
})();
