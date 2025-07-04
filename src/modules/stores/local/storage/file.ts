import fs from 'fs/promises';
import { createWriteStream } from 'fs';
import { dirname } from 'path';
import type { IFileStorage } from '@beyond-js/packages/stores/interfaces';

export class LocalFileStorage implements IFileStorage {
	async stream(path: string): Promise<NodeJS.WritableStream> {
		await fs.mkdir(dirname(path), { recursive: true });
		return createWriteStream(path);
	}

	async load(path: string): Promise<Buffer> {
		return await fs.readFile(path);
	}

	async exists(path: string): Promise<boolean> {
		try {
			await fs.access(path);
			return true;
		} catch {
			return false;
		}
	}

	async delete(path: string): Promise<void> {
		await fs.unlink(path);
	}
}
