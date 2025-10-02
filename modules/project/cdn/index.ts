import { Dependencies } from './dependencies';
import { PackageProviders } from './package-providers';
import { db } from '@beyond-js/packages/persistence/db';
import { PendingPromise } from '@beyond-js/pending-promise/main';

export /*bundle*/ class Project {
	#id: string;
	get id() {
		return this.#id;
	}

	#dependencies: Dependencies;
	get dependencies() {
		return this.#dependencies;
	}

	#packages: Packages;
	get packages() {
		return this.#packages;
	}

	#ready: PendingPromise<void> = new PendingPromise();
	get ready() {
		return this.#ready;
	}

	#error: Error;
	get error() {
		return this.#error;
	}

	constructor(id: string) {
		this.#initialize()
			.then(this.#ready.resolve)
			.catch(error => {
				this.#error = error;
				this.#ready.resolve();
			});
	}

	async #initialize() {
		const id = this.#id;
		const response = await db.projects.get({ id });

		this.#dependencies = new Dependencies();
		this.#packages = new Packages(this);
	}
}
