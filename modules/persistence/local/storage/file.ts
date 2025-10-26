import type { IFileStorage } from '@beyond-js/packages/persistence/types';
import * as fs from 'fs';
import { dirname, join } from 'path';
import { PendingPromise } from '@beyond-js/pending-promise/main';

const { createWriteStream } = fs;
const { readFile, access, rm, mkdir } = fs.promises;

const ready = new PendingPromise<void>();
let path: string;

export /*bundle*/ async function inittialize() {
	// As BeyondJS transpiles to CJS, we need to use dynamic import
	const envpaths = (await import('env-paths')).default;

	const paths = envpaths('beyond-js');
	path = join(paths.cache);

	ready.resolve();
}

/**
 * File implementation for local filesystem storage.
 */
export /*bundle*/ class File implements IFileStorage {
	// Root directory for the file storage (ex: "packages")
	readonly #root: string;
	get root(): string {
		return this.#root;
	}

	// Relative path to the file within the root directory
	readonly #path: string;
	get path(): string {
		return this.#path;
	}

	// Full path to the file in the local filesystem
	get fullpath(): string {
		return join(path, this.#root, this.#path);
	}

	constructor(root: string, path: string) {
		this.#root = root;
		this.#path = path;
	}

	async stream(): Promise<NodeJS.WritableStream> {
		await ready;
		await mkdir(dirname(this.fullpath), { recursive: true });
		return createWriteStream(this.fullpath);
	}

	async load(): Promise<Buffer> {
		await ready;
		return readFile(this.fullpath);
	}

	async exists(): Promise<boolean> {
		await ready;

		try {
			await access(this.fullpath);
			return true;
		} catch {
			return false;
		}
	}

	async delete(): Promise<void> {
		await ready;
		await rm(this.fullpath, { force: true });
	}
}
