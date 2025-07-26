import type { IFileStorage } from '@beyond-js/packages/persistence/types';
import { createWriteStream, promises as fs } from 'fs';
import { dirname, join } from 'path';
import { mkdir } from 'fs/promises';

/**
 * File implementation for local filesystem storage.
 */
export class File implements IFileStorage {
	readonly #root: string;
	get root(): string {
		return this.#root;
	}

	readonly #path: string;
	get path(): string {
		return this.#path;
	}

	readonly #fullpath: string;
	get fullpath(): string {
		return this.#fullpath;
	}

	constructor(root: string, path: string) {
		this.#root = root;
		this.#path = path;
		this.#fullpath = join(process.cwd(), `.beyond/${this.root}`, this.path);
	}

	async stream(): Promise<NodeJS.WritableStream> {
		await mkdir(dirname(this.#fullpath), { recursive: true });
		return createWriteStream(this.#fullpath);
	}

	async load(): Promise<Buffer> {
		return fs.readFile(this.#fullpath);
	}

	async exists(): Promise<boolean> {
		try {
			await fs.access(this.#fullpath);
			return true;
		} catch {
			return false;
		}
	}

	async delete(): Promise<void> {
		await fs.rm(this.#fullpath, { force: true });
	}
}
