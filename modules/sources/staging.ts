import type { IStoreStage } from './types';
import { promises as fs, createWriteStream } from 'fs';
import { type Readable, promises as streams } from 'stream';
import { randomBytes } from 'crypto';
import { join, resolve, dirname, sep } from 'path';

// The file that proves a stage is the one its owner opened: a stage moved aside by a sweep and recreated by a later
// write has none, and is never published
const MARKER = '.stage';

/**
 * A source being written below the staging directory of a `FilesystemStore`
 */
export class FilesystemStage implements IStoreStage {
	#directory: string;
	get directory() {
		return this.#directory;
	}

	#token: string;

	constructor(directory: string, token: string) {
		this.#directory = directory;
		this.#token = token;
	}

	async write(path: string, content: Readable): Promise<number> {
		const root = join(this.#directory, 'files');
		const target = resolve(root, ...path.split('/'));
		if (!target.startsWith(root + sep)) throw new Error('The path leaves the stage');

		await fs.mkdir(dirname(target), { recursive: true });
		const file = createWriteStream(target);
		await streams.pipeline(content, file);
		return file.bytesWritten;
	}

	/**
	 * Whether the stage is still the one that was opened, and not a directory a later write recreated after a sweep
	 * moved the stage aside. The marker is removed once confirmed, so a published source does not hold it.
	 */
	async confirm(): Promise<boolean> {
		const marker = join(this.#directory, MARKER);
		const token = await fs.readFile(marker, 'utf8').catch((): string => void 0);
		if (token !== this.#token) return false;
		await fs.rm(marker, { force: true });
		return true;
	}
}

/**
 * The staging directory of a store (`<root>/.staging`): where each source is written (`source-*`) before it
 * is published or discarded, and where a process that ended in the middle of a download leaves its stage.
 *
 * A stage is abandoned when it is not open in this process and nothing was added to it for longer than the
 * download timeout: a download in another process that uses the same timeout has been aborted by then. An
 * abandoned stage is moved aside with one atomic rename (`trash-*`) and only then deleted, so whoever still
 * owns it finds it gone at once instead of half deleted, and a stage that was moved aside is never published.
 * A store sweeps once before the first stage it opens, unless `clean` already did.
 */
export class Staging {
	// Stages open in this process, whichever store opened them: never moved aside
	static #open: Set<string> = new Set();

	#directory: string;
	#timeout: number;
	#swept?: Promise<number>;

	get directory() {
		return this.#directory;
	}

	/**
	 * @param root The root of the store
	 * @param timeout Milliseconds a download may take: an untouched stage older than this was abandoned
	 */
	constructor(root: string, timeout: number) {
		this.#directory = join(root, '.staging');
		this.#timeout = timeout;
	}

	/**
	 * Opens a new stage, once the abandoned stages are removed
	 */
	async open(): Promise<FilesystemStage> {
		// A failed sweep leaves abandoned stages in place and must never prevent a fetch
		await (this.#swept ?? this.clean()).catch((): number => 0);

		await fs.mkdir(this.#directory, { recursive: true });
		const directory = await fs.mkdtemp(join(this.#directory, 'source-'));
		const token = randomBytes(12).toString('hex');
		Staging.#open.add(directory);
		try {
			await fs.writeFile(join(directory, MARKER), token);
		} catch (error) {
			Staging.#open.delete(directory);
			await fs.rm(directory, { recursive: true, force: true }).catch((): void => void 0);
			throw error;
		}
		return new FilesystemStage(directory, token);
	}

	/**
	 * Forgets a stage that was published or discarded
	 */
	close(stage: FilesystemStage): void {
		Staging.#open.delete(stage.directory);
	}

	/**
	 * Removes the abandoned stages, and what an interrupted sweep left aside
	 *
	 * @param timeout Milliseconds without changes after which a stage that is not open is abandoned; never less
	 *   than the timeout of the store
	 * @returns How many stages were removed
	 */
	clean(timeout?: number): Promise<number> {
		const bound = Math.max(typeof timeout === 'number' && timeout > 0 ? timeout : 0, this.#timeout);
		this.#swept = this.#sweep(bound);
		return this.#swept;
	}

	/**
	 * Moves a directory of the store aside with one atomic rename, then deletes it
	 *
	 * @returns Whether it was moved aside: false when it was already gone
	 */
	async trash(directory: string): Promise<boolean> {
		const aside = join(this.#directory, `trash-${randomBytes(8).toString('hex')}`);
		try {
			await fs.mkdir(this.#directory, { recursive: true });
			await fs.rename(directory, aside);
		} catch (error) {
			if (error?.code === 'ENOENT') return false;
			throw error;
		}
		// What cannot be deleted now is deleted by a later sweep: nobody reads a directory moved aside
		await fs.rm(aside, { recursive: true, force: true }).catch((): void => void 0);
		return true;
	}

	async #sweep(bound: number): Promise<number> {
		let entries: string[];
		try {
			entries = await fs.readdir(this.#directory);
		} catch (error) {
			if (error?.code === 'ENOENT') return 0;
			throw error;
		}

		let removed = 0;
		const now = Date.now();
		for (const entry of entries) {
			const directory = join(this.#directory, entry);
			if (entry.startsWith('trash-')) {
				await fs.rm(directory, { recursive: true, force: true }).catch((): void => void 0);
				continue;
			}
			if (!entry.startsWith('source-') || Staging.#open.has(directory)) continue;

			const touched = await this.#touched(directory);
			if (touched === void 0 || now - touched <= bound) continue;
			if (await this.trash(directory)) removed++;
		}
		return removed;
	}

	/**
	 * When a stage last changed: the newest modification of the stage or of its `files` directory
	 */
	async #touched(directory: string): Promise<number | undefined> {
		const times = await Promise.all(
			[directory, join(directory, 'files')].map(path =>
				fs.stat(path).then(
					stat => stat.mtimeMs,
					(): number => void 0
				)
			)
		);
		const known = times.filter(time => time !== void 0);
		return known.length ? Math.max(...known) : void 0;
	}
}
