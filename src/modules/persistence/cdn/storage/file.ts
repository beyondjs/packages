import { Storage, Bucket } from '@google-cloud/storage';
import type { IFileStorage } from '@beyond-js/packages/persistence/interfaces';

export class GCloudFileStorage implements IFileStorage {
	#bucket: Bucket;

	constructor(bucketName: string) {
		const storage = new Storage();
		this.#bucket = storage.bucket(bucketName);
	}

	async stream(path: string): Promise<NodeJS.WritableStream> {
		const file = this.#bucket.file(path);
		return file.createWriteStream();
	}

	async load(path: string): Promise<Buffer> {
		const file = this.#bucket.file(path);
		const [contents] = await file.download();
		return contents;
	}

	async exists(path: string): Promise<boolean> {
		const file = this.#bucket.file(path);
		const [exists] = await file.exists();
		return exists;
	}

	async delete(path: string): Promise<void> {
		const file = this.#bucket.file(path);
		await file.delete();
	}
}
