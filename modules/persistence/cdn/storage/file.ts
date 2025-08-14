import type { IFileStorage } from '@beyond-js/packages/persistence/types';
import { Storage } from '@google-cloud/storage';

/**
 * File implementation for Google Cloud Storage.
 */
export /*bundle*/ class File implements IFileStorage {
	readonly #root: string;
	get root(): string {
		return this.#root;
	}

	readonly #path: string;
	get path(): string {
		return this.#path;
	}

	readonly #bucket: ReturnType<Storage['bucket']>;
	readonly #file: ReturnType<ReturnType<Storage['bucket']>['file']>;

	constructor(root: string, path: string) {
		this.#root = root;
		this.#path = path;

		const storage = new Storage();
		this.#bucket = storage.bucket(this.root);
		this.#file = this.#bucket.file(this.path);
	}

	async stream(): Promise<NodeJS.WritableStream> {
		return this.#file.createWriteStream();
	}

	async load(): Promise<Buffer> {
		const [buffer] = await this.#file.download();
		return buffer;
	}

	async exists(): Promise<boolean> {
		const [exists] = await this.#file.exists();
		return exists;
	}

	async delete(): Promise<void> {
		await this.#file.delete({ ignoreNotFound: true });
	}
}
