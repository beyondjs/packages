import { promises as fs } from 'fs';
import { join } from 'path';
import type { Root } from './root';
import type { Log } from './log';
import { Revision } from './revision';

export /*bundle*/ interface IEntry {
	path: string;
	kind: 'file' | 'directory';
	size?: number;
	revision?: string;
}

interface IKnown extends IEntry {
	modified?: number;
}

type Origin = 'api' | 'external' | 'scan';

/**
 * The index of what has been announced: for every visible path, the revision clients were last told about.
 *
 * Disk is the authority. `examine` compares one path with disk and announces the difference; `scan` does it
 * for the whole root. An API mutation records its own result with `record`, which is what makes a watcher
 * hint about the same write find nothing to announce.
 */
export class Entries {
	#root: Root;
	#log: Log;
	#known = new Map<string, IKnown>();

	constructor(root: Root, log: Log) {
		this.#root = root;
		this.#log = log;
	}

	list(prefix?: string): IEntry[] {
		const inside = (path: string) => !prefix || path === prefix || path.startsWith(`${prefix}/`);
		return [...this.#known.values()]
			.filter(entry => inside(entry.path))
			.map(({ modified, ...entry }) => entry)
			.sort((a, b) => (a.path < b.path ? -1 : 1));
	}

	get(path: string): IEntry | undefined {
		return this.#known.get(path);
	}

	/**
	 * Record the result of an API mutation and announce it with its author
	 */
	record(path: string, bytes: Buffer | undefined, data: Record<string, unknown>) {
		const previous = this.#known.get(path)?.revision;
		if (!bytes) {
			this.#known.delete(path);
			return this.#log.append('file.deleted', { path, previous, origin: 'api', ...data });
		}
		const revision = Revision.of(bytes);
		this.#known.set(path, { path, kind: 'file', size: bytes.length, revision });
		if (previous === revision) return;
		return this.#log.append(previous ? 'file.changed' : 'file.created', { path, revision, previous, origin: 'api', ...data });
	}

	/**
	 * Move an entry without announcing: an API rename is announced by its caller as one event
	 */
	move(from: string, to: string) {
		const known = this.#known.get(from);
		this.#known.delete(from);
		known && this.#known.set(to, { ...known, path: to, modified: undefined });
	}

	/**
	 * Compare one path with disk and announce the difference
	 */
	async examine(path: string, origin: Origin) {
		if (!this.#root.visible(path)) return;
		const file = join(this.#root.path, ...path.split('/'));
		const known = this.#known.get(path);

		const stat = await fs.lstat(file).catch((): undefined => undefined);
		if (!stat || stat.isSymbolicLink()) return void (known && this.#remove(path, origin));
		if (stat.isDirectory()) {
			if (known?.kind === 'file') this.#remove(path, origin);
			this.#known.set(path, { path, kind: 'directory' });
			return this.#walk(path, origin);
		}
		if (!stat.isFile()) return;
		// An unchanged size and modification time is trusted between scans; a mutation never relies on it
		if (known?.kind === 'file' && known.size === stat.size && known.modified === stat.mtimeMs) return;

		const bytes = await fs.readFile(file).catch((): undefined => undefined);
		if (!bytes) return void (known && this.#remove(path, origin));
		const revision = Revision.of(bytes);
		this.#known.set(path, { path, kind: 'file', size: bytes.length, revision, modified: stat.mtimeMs });
		if (known?.revision === revision) return;
		const type = known?.kind === 'file' ? 'file.changed' : 'file.created';
		this.#log.append(type, { path, revision, previous: known?.revision, origin });
	}

	#remove(path: string, origin: Origin) {
		for (const entry of this.list(path)) {
			this.#known.delete(entry.path);
			entry.kind === 'file' && this.#log.append('file.deleted', { path: entry.path, previous: entry.revision, origin });
		}
	}

	async #walk(directory: string, origin: Origin) {
		const absolute = directory ? join(this.#root.path, ...directory.split('/')) : this.#root.path;
		const names = await fs.readdir(absolute).catch((): string[] => []);
		for (const name of names) await this.examine(directory ? `${directory}/${name}` : name, origin);
	}

	/**
	 * Re-read the whole root: announce what disk has that the index lacks, and what the index has that disk lost
	 *
	 * @param silent Build the index without announcing, for the first scan of a run
	 */
	async scan(silent = false) {
		if (silent) {
			const quiet = new Entries(this.#root, { append: () => undefined } as unknown as Log);
			await quiet.#walk('', 'scan');
			this.#known = quiet.#known;
			return;
		}
		for (const path of [...this.#known.keys()]) {
			const present = await fs.lstat(join(this.#root.path, ...path.split('/'))).then(() => true, () => false);
			!present && this.#known.has(path) && this.#remove(path, 'scan');
		}
		await this.#walk('', 'scan');
	}
}
