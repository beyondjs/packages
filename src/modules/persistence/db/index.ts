import { PendingPromise } from '@beyond-js/pending-promise/main';
import type { Packages } from '@beyond-js/packages/persistence/types';

declare const bimport: (module: string) => Promise<any>;

interface IOptions {
	cdn?: {
		account: string;
		project: string;
		token: string;
	};
}

export class DB {
	#ready: PendingPromise<void>;

	#packages: Packages;
	get packages() {
		return this.#packages;
	}

	async init(options: IOptions = {}): Promise<void> {
		if (this.#ready) return await this.#ready;
		this.#ready = new PendingPromise<void>();

		const { cdn } = options;
		const env = cdn ? 'cdn' : 'local';
		const { packages } = await bimport(`@beyond-js/packages/persistence/${env}/db`);

		this.#packages = packages;
		this.#ready.resolve();
	}
}

export /*bundle*/ const db = new DB();
