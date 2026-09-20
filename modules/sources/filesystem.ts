import type { Readable } from 'stream';
import type { IStore, IStoreRecord, IStoreStage, IStoredSource } from './types';
import { promises as fs, createWriteStream } from 'fs';
import { promises as streams } from 'stream';
import { join, resolve, dirname, sep, isAbsolute } from 'path';
import { Integrity } from './integrity';

/**
 * A source being written below the staging directory of a `FilesystemStore`
 */
export class FilesystemStage implements IStoreStage {
	#directory: string;
	get directory() {
		return this.#directory;
	}

	constructor(directory: string) {
		this.#directory = directory;
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
}

/**
 * Keeps verified sources in a directory:
 *
 *     <root>/<scope>/<origin>/<name>/<version>/<integrity>/source.json   what was verified
 *     <root>/<scope>/<origin>/<name>/<version>/<integrity>/files/…        the extracted package
 *
 * where `<scope>` is `public` or `org/<tenant>`. A source is written in `<root>/.staging` and published
 * by renaming its directory, which is atomic within one filesystem: a reader finds the whole source or
 * nothing. A source of one scope is never found through another.
 */
export /*bundle*/ class FilesystemStore implements IStore {
	#root: string;
	get root() {
		return this.#root;
	}

	constructor(root: string) {
		if (typeof root !== 'string' || !isAbsolute(root)) throw new Error('The store root must be an absolute path');
		this.#root = resolve(root);
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

	async has(record: IStoreRecord): Promise<boolean> {
		try {
			await fs.access(join(this.#directory(record), 'source.json'));
			return true;
		} catch {
			return false;
		}
	}

	async get(record: IStoreRecord): Promise<IStoredSource | undefined> {
		const directory = this.#directory(record);
		try {
			const source: IStoredSource = JSON.parse(await fs.readFile(join(directory, 'source.json'), 'utf8'));
			return { ...source, location: join(directory, 'files') };
		} catch {
			return;
		}
	}

	async put(record: IStoreRecord): Promise<IStoreStage> {
		const staging = join(this.#root, '.staging');
		await fs.mkdir(staging, { recursive: true });
		return new FilesystemStage(await fs.mkdtemp(join(staging, 'source-')));
	}

	async commit(stage: FilesystemStage, source: IStoredSource): Promise<IStoredSource> {
		// The lookup key of an established source is its record, not the digest computed afterwards
		const record = source.key.endsWith('/established') ? { ...source, integrity: 'established' } : source;
		const directory = this.#directory(record);

		const { location, ...data } = source;
		await fs.mkdir(join(stage.directory, 'files'), { recursive: true });
		await fs.writeFile(join(stage.directory, 'source.json'), JSON.stringify(data, null, '\t'));
		await fs.mkdir(dirname(directory), { recursive: true });

		try {
			await fs.rename(stage.directory, directory);
		} catch (error) {
			// Published meanwhile by another fetch: that source is as verified as this one
			await this.discard(stage);
			const published = await this.get(record);
			if (published) return published;
			throw error;
		}
		return { ...data, location: join(directory, 'files') };
	}

	async discard(stage: FilesystemStage): Promise<void> {
		await fs.rm(stage.directory, { recursive: true, force: true });
	}
}
