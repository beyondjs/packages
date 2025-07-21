import { entities } from '#store';
import Downloader from './downloader.js';
import PendingPromise from '@beyond-js/pending-promise';
import Files from './files.js';
import File from './files/file.js';

const { VPackage: VPackageStore } = entities;

export default class {
	#pkg: string;
	get pkg(): string {
		return this.#pkg;
	}

	#version: string;
	get version(): string {
		return this.#version;
	}

	get vpkg(): string {
		return `${this.#pkg}@${this.#version}`;
	}

	#store: VPackageStore;

	#found: boolean | undefined;
	get found(): boolean | undefined {
		return this.#found;
	}

	#files: Files;
	get files(): Files {
		return this.#files;
	}

	#error: string | undefined;
	get error(): string | undefined {
		return this.#error;
	}

	get valid(): boolean {
		return !!this.#found && !this.#error;
	}

	#processing: boolean | undefined;
	get processing(): boolean | undefined {
		return this.#processing;
	}

	#processed: boolean | undefined;
	get processed(): boolean | undefined {
		return this.#processed;
	}

	#promise: PendingPromise<void> | undefined;

	constructor(pkg: string, version: string) {
		if (!pkg || !version) throw new Error('Invalid parameters');

		this.#pkg = pkg;
		this.#version = version;
		this.#files = new Files(pkg, version);
		this.#store = new VPackageStore(pkg, version);
	}

	async process(specs?: Specs): Promise<void> {
		if (this.#promise) return await this.#promise;
		this.#promise = new PendingPromise();

		specs = specs || {};
		const { logger } = specs;

		await this.#store.load();
		const stored = this.#store.value?.files;
		if (stored) {
			this.#processing = !!stored.processing;
			this.#processed = !!stored.processed;
			this.#found = stored.found;
			this.#error = stored.error;
			this.#files.hydrate(stored.files);

			this.#promise.resolve();
			return;
		}

		/**
		 * Set in the store that the vpackage is being processed to avoid processing the same vpackage more than once
		 */
		this.#processing = true;
		this.#processed = false;
		await this.#store.set({ files: { processing: true } });

		/**
		 * Download the vpackage
		 */
		const downloader = new Downloader(this.#pkg, this.#version);
		const vname = `${this.#pkg}@${this.#version}`;
		logger?.add(`Downloading "${vname}"`);
		await downloader.process();
		const { valid, found, error, files } = downloader;
		logger?.add(valid ? `  … Package "${vname}" download done` : ` … Couldn't download "${vname}": ${error}`);

		/**
		 * Save the meta information to the store and
		 * create the files objects that are responsible to make its downloads
		 */
		this.#processed = true;
		this.#processing = false;
		this.#found = found;
		this.#error = error;
		valid && files.forEach(info => this.#files.set(info.path, new File(this.#pkg, this.#version, info)));

		const store = { processed: true, found };
		valid && (store.files = this.#files.toJSON());
		error && (store.error = error);
		await this.#store.set({ files: store });

		this.#promise.resolve();
	}
}
