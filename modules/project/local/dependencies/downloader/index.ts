import type { Project } from '../..';
import type { ILockFile } from '../lockfile';
import { File } from '@beyond-js/packages/persistence/storage';
import { DependencySource } from '@beyond-js/packages/dependency-source';
import { sanitize } from './sanitize';
import { Queue } from './queue';
import { db } from '@beyond-js/packages/persistence/db';
import { createGunzip } from 'zlib';
import * as stream from 'stream';
import * as tar from 'tar-stream';
import { join, resolve, relative } from 'path';

const { pipeline } = stream.promises;
const ROOT = 'packages';

/**
 * Downloads and extracts a tarball into the appropriate storage backend.
 */
export /*bundle*/ class DependenciesDownloader {
	readonly #project: Project;

	constructor(project: Project) {
		this.#project = project;
	}

	/**
	 * Downloads the tarball and extracts its content to file storage.
	 */
	async #download(id: string, path: string, url: string, headers: Record<string, string>): Promise<void> {
		// Download tarball as stream
		// Comments in English: add a request timeout
		const ac = new AbortController();
		const t = setTimeout(() => ac.abort(), 30_000); // 30s, tune as needed

		let response: Response;
		try {
			response = await fetch(url, { headers, signal: ac.signal });
		} finally {
			clearTimeout(t);
		}

		if (!response.ok || !response.body) {
			throw new Error(`Failed to fetch tarball from ${url}: ${response.statusText}`);
		}

		// Base dir where all files must land (absolute)
		const base = resolve(ROOT, path);

		const extract = tar.extract();
		extract.on('entry', async (header, entryStream, next) => {
			try {
				// Reject links explicitly
				if (header.type === 'symlink' || header.type === 'link') {
					entryStream.resume();
					return next(new Error(`Links are not allowed: ${header.name}`)); // Security hard fail
				}
				if (header.type !== 'file') {
					entryStream.resume(); // skip directories, etc.
					return next();
				}

				const sanitized = sanitize(header.name, base);
				const relbase = relative(ROOT, base);
				const target = join(relbase, sanitized);

				const file = new File(ROOT, target);

				const writeStream = await file.stream();
				await pipeline(entryStream, writeStream);
				next();
			} catch (exc) {
				entryStream.resume();
				next(exc);
				return;
			}
		});

		const gunzip = createGunzip();

		extract.once('error', e => {
			throw e;
		});
		gunzip.once('error', e => {
			throw e;
		});

		// Convert Web ReadableStream (returned by fetch in Node 18+) to a Node.js Readable stream.
		// This ensures compatibility with stream.pipeline(), which expects Node streams.
		// Required for Node versions <18.17 (automatic conversion added in 18.17+, stable in 20+).
		const { Readable } = stream;
		const src = Readable.fromWeb(response.body as any);
		await pipeline(src, gunzip, extract);

		const data = { id, path, public: true };
		await db.installed.set({ id, data });
	}

	async process(lockfile: ILockFile): Promise<void> {
		const list = Object.values(lockfile);
		const project = this.#project;

		const queue = new Queue(6); // 4–8 suele ir bien

		const tasks = list.map(v => {
			return queue.run(async () => {
				const { name, version } = v;
				const src = new DependencySource(name, version.specified);
				const info = await project.packages.tarball(src, version.resolved);
				const { id, path, url, headers } = info;
				await this.#download(id, path, url, headers);
			});
		});

		await Promise.all(tasks);
	}
}
