import type { IStore, IStoreRecord, IStoreStage, IStoredSource } from './types';
import { promises as fs } from 'fs';
import { join, resolve, dirname, isAbsolute } from 'path';
import { Integrity } from './integrity';
import { Limits } from './limits';
import { type FilesystemStage, Staging } from './staging';

/**
 * Options of a `FilesystemStore`
 */
export /*bundle*/ interface IFilesystemStoreOptions {
	// Milliseconds a download may take (the `timeout` of the fetch limits, 120000 by default): a stage that is
	// not open in this process and was not changed for longer than this was abandoned and is removed
	timeout?: number;
}

/**
 * Keeps verified sources in a directory:
 *
 *     <root>/<scope>/<origin>/<name>/<version>/<integrity>/source.json   what was verified
 *     <root>/<scope>/<origin>/<name>/<version>/<integrity>/files/…        the extracted package
 *
 * where `<scope>` is `public` or `org/<tenant>`. A source is written in `<root>/.staging` and published
 * by renaming its directory, which is atomic within one filesystem: a reader finds the whole source or
 * nothing. A source of one scope is never found through another. The stages a process abandoned (it ended
 * in the middle of a download) are removed before the store opens its first stage, and by `clean`.
 */
export /*bundle*/ class FilesystemStore implements IStore {
	#root: string;
	/**
	 * The absolute directory of the store
	 */
	get root() {
		return this.#root;
	}

	#staging: Staging;

	/**
	 * @param root Absolute directory of the store
	 */
	constructor(root: string, options: IFilesystemStoreOptions = {}) {
		if (typeof root !== 'string' || !isAbsolute(root)) throw new Error('The store root must be an absolute path');
		this.#root = resolve(root);
		this.#staging = new Staging(this.#root, new Limits({ timeout: options.timeout }).timeout);
	}

	#segment(value: string): string {
		const encoded = encodeURIComponent(value);
		if (!encoded || encoded === '.' || encoded === '..') throw new Error('Invalid store key segment');
		return encoded;
	}

	#directory({ scope, origin, name, version, integrity }: IStoreRecord): string {
		const tenant = scope.startsWith('org:') ? ['org', this.#segment(scope.slice(4))] : [this.#segment(scope)];
		const parsed = new Integrity(integrity);
		const digest = parsed.valid ? parsed.id : integrity;
		return join(this.#root, ...tenant, ...[origin, name, version, digest].map(value => this.#segment(value)));
	}

	/**
	 * The directory the files of a source are published at, whether or not the store holds it. The record of
	 * a source whose integrity was established at fetch is looked up with the integrity `established`.
	 */
	location(record: IStoreRecord): string {
		return join(this.#directory(record), 'files');
	}

	/**
	 * Whether the store holds a source: what was verified and its files. A source whose files were removed is
	 * not held, so it is fetched again
	 */
	async has(record: IStoreRecord): Promise<boolean> {
		const directory = this.#directory(record);
		try {
			await fs.access(join(directory, 'source.json'));
			return (await fs.stat(join(directory, 'files'))).isDirectory();
		} catch {
			return false;
		}
	}

	/**
	 * What was verified of a source the store holds, with the `location` of its files
	 */
	async get(record: IStoreRecord): Promise<IStoredSource | undefined> {
		if (!(await this.has(record))) return;
		const directory = this.#directory(record);
		try {
			const source: IStoredSource = JSON.parse(await fs.readFile(join(directory, 'source.json'), 'utf8'));
			return { ...source, location: join(directory, 'files') };
		} catch {
			return;
		}
	}

	/**
	 * Opens a stage to write a source into, once the abandoned stages are removed
	 */
	async put(record: IStoreRecord): Promise<IStoreStage> {
		void record;
		return await this.#staging.open();
	}

	/**
	 * Publishes a stage atomically, or answers the source another fetch published meanwhile. A stage that a sweep
	 * moved aside is never published, even when a later write recreated its directory (`STAGE_LOST`).
	 */
	async commit(stage: FilesystemStage, source: IStoredSource): Promise<IStoredSource> {
		// The lookup key of an established source is its record, not the digest computed afterwards
		const record = source.key.endsWith('/established') ? { ...source, integrity: 'established' } : source;
		const directory = this.#directory(record);
		const { location, ...data } = source;

		let published: IStoredSource | undefined;
		try {
			const lost = Object.assign(new Error('The stage was moved aside'), { code: 'STAGE_LOST' });
			if (!(await stage.confirm())) throw lost;
			// Never recursive: a stage that is gone must not be recreated empty and published
			await fs.mkdir(join(stage.directory, 'files')).catch(error => {
				if (error?.code !== 'EEXIST') throw error;
			});
			await fs.writeFile(join(stage.directory, 'source.json'), JSON.stringify(data, null, '\t'));
			await fs.mkdir(dirname(directory), { recursive: true });
			published = await this.#publish(stage, directory, record);
		} catch (error) {
			await this.discard(stage);
			throw error;
		}
		if (published) {
			await this.discard(stage);
			return published;
		}
		this.#staging.close(stage);
		return { ...data, location: join(directory, 'files') };
	}

	/**
	 * Renames a stage to the directory of its source
	 *
	 * @returns The source another fetch published meanwhile, which is as verified as this one; undefined when the
	 *   stage was published. What remains of a source whose files were removed is moved aside atomically and
	 *   replaced by the stage
	 */
	async #publish(
		stage: FilesystemStage,
		directory: string,
		record: IStoreRecord
	): Promise<IStoredSource | undefined> {
		try {
			await fs.rename(stage.directory, directory);
			return;
		} catch (error) {
			const published = await this.get(record);
			if (published) return published;

			const remains = await fs.stat(directory).then(
				stat => stat.isDirectory(),
				(): boolean => false
			);
			if (!remains) throw error;
		}

		await this.#staging.trash(directory);
		try {
			await fs.rename(stage.directory, directory);
		} catch (error) {
			// Another fetch replaced the same remnant first
			const published = await this.get(record);
			if (published) return published;
			throw error;
		}
		return;
	}

	/**
	 * Removes everything a stage wrote
	 */
	async discard(stage: FilesystemStage): Promise<void> {
		try {
			await fs.rm(stage.directory, { recursive: true, force: true });
		} finally {
			this.#staging.close(stage);
		}
	}

	/**
	 * Removes the stages that were abandoned: not open in this process and unchanged for longer than the given
	 * milliseconds, never less than the download timeout of the store. Each is moved aside atomically before it
	 * is deleted. The first stage a store opens waits for this sweep instead of running another one.
	 *
	 * @returns How many stages were removed
	 */
	async clean(timeout?: number): Promise<number> {
		return await this.#staging.clean(timeout);
	}
}
