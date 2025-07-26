import type { IFileStorage } from '@beyond-js/packages/persistence/types';
import * as fs from 'fs';
import { dirname, join } from 'path';

const { createWriteStream } = fs;
const { readFile, access, rm, mkdir } = fs.promises;

/**
 * File implementation for local filesystem storage.
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
		return readFile(this.#fullpath);
	}

	async exists(): Promise<boolean> {
		try {
			await access(this.#fullpath);
			return true;
		} catch {
			return false;
		}
	}

	async delete(): Promise<void> {
		await rm(this.#fullpath, { force: true });
	}
}
