import { PendingPromise } from '@beyond-js/pending-promise/main';
import type { Packages, Conditionals } from '@beyond-js/packages/persistence/types';

declare const bimport: (module: string) => Promise<any>;

export /*bundle*/ const db = new (class DB {
	#ready: PendingPromise<void>;

	#packages: Packages;
	get packages() {
		return this.#packages;
	}

	#conditionals: Conditionals;
	get conditionals() {
		return this.#conditionals;
	}

	async init(cdn?: boolean): Promise<void> {
		if (this.#ready) return await this.#ready;
		this.#ready = new PendingPromise<void>();

		const env = cdn ? 'cdn' : 'local';
		const { packages, conditionals } = await bimport(`@beyond-js/packages/persistence/${env}/db`);

		this.#packages = packages;
		this.#conditionals = conditionals;
		this.#ready.resolve();
	}
})();
