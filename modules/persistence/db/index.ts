import { PendingPromise } from '@beyond-js/pending-promise/main';
import type { Packages, Conditionals, Releases } from '@beyond-js/packages/persistence/types';
import type { Projects } from '@beyond-js/packages/persistence/types/cdn';

declare const bimport: (module: string) => Promise<any>;

export /*bundle*/ const db = new (class DB {
	#ready: PendingPromise<void>;
	#initialised = false;

	#env: string;
	get env() {
		return this.#env;
	}

	/**
	 * Only avaialble when server is running in CDN environment
	 */
	#projects?: Projects;
	get projects() {
		if (!this.#initialised) throw new Error('Database not initialised. Call the init method first.');
		return this.#projects;
	}

	#packages: Packages;
	get packages() {
		if (!this.#initialised) throw new Error('Database not initialised. Call the init method first.');
		return this.#packages;
	}

	#releases: Releases;
	get releases() {
		if (!this.#initialised) throw new Error('Database not initialised. Call the init method first.');
		return this.#releases;
	}

	#conditionals: Conditionals;
	get conditionals() {
		if (!this.#initialised) throw new Error('Database not initialised. Call the init method first.');
		return this.#conditionals;
	}

	async init(options: { cdn?: boolean }): Promise<void> {
		if (this.#ready) return await this.#ready;
		this.#ready = new PendingPromise<void>();

		const env = options.cdn ? 'cdn' : 'local';
		const db = await bimport(`@beyond-js/packages/persistence/${env}/db`);
		const { projects, packages, releases, conditionals } = db;

		this.#env = env;
		this.#projects = projects;
		this.#packages = packages;
		this.#releases = releases;
		this.#conditionals = conditionals;
		this.#ready.resolve();

		this.#initialised = true;
	}
})();
