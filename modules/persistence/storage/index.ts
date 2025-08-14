import type { IFileStorage } from '@beyond-js/packages/persistence/types';
import { PendingPromise } from '@beyond-js/pending-promise/main';

declare const bimport: (module: string) => Promise<any>;

let ready: PendingPromise<void>;
let Provider: new (root: string, path: string) => IFileStorage;

export /*bundle*/ class Storage {
	/**
	 * Initializes the underlying storage system depending on the environment.
	 *
	 * @param cdn - Whether the app is running in a CDN/cloud environment (true) or local (false).
	 */
	static async init(cdn: boolean = false): Promise<void> {
		if (ready) return await ready;
		ready = new PendingPromise<void>();

		const env = cdn ? 'cdn' : 'local';
		const { File } = await bimport(`@beyond-js/packages/persistence/${env}/storage`);
		Provider = File;

		console.log(`Storage initialized with "${env}" 'provider`, Provider);
		ready.resolve();
	}
}

/**
 * Unified wrapper for file storage (local or cloud).
 * Automatically delegates to the correct storage backend (local filesystem or Google Cloud Storage).
 * Must be initialized with File.init() before creating any File instance.
 */
export /*bundle*/ class File implements IFileStorage {
	readonly #file: IFileStorage;

	get root(): string {
		return this.#file.root;
	}
	get path(): string {
		return this.#file.path;
	}

	/**
	 * Creates a new file instance under the given root namespace.
	 *
	 * @param root - Logical storage root (e.g., "packages").
	 *               It maps to a folder in local storage or a GCS bucket root.
	 * @param path - Relative path to the file within the root namespace.
	 *               Example: "npm/lodash/4.17.21/index.js"
	 */
	constructor(root: string, path: string) {
		if (!Provider) throw new Error('File storage not initialized. Call File.init() before using File.');
		this.#file = new Provider(root, path);
	}

	/** Returns a writable stream to store the file. */
	async stream(): Promise<NodeJS.WritableStream> {
		return this.#file.stream();
	}

	/** Loads and returns the contents of the file as a Buffer. */
	async load(): Promise<Buffer> {
		return this.#file.load();
	}

	/** Checks whether the file exists. */
	async exists(): Promise<boolean> {
		return this.#file.exists();
	}

	/** Deletes the file. */
	async delete(): Promise<void> {
		return this.#file.delete();
	}
}
