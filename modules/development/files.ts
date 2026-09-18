import { promises as fs } from 'fs';
import { Root } from './root';
import { Log } from './log';
import { Entries, type IEntry } from './entries';
import { Mutations, type IActor, type IMutation, type IMutationResult } from './mutations';
import { Observer } from './observer';
import { Sequence } from './sequence';
import { Revision } from './revision';
import { DevelopmentError } from './error';

export /*bundle*/ interface ITree {
	protocol: 'beyond-dev-files/1';
	cursor: string;
	scanned: boolean;
	entries: IEntry[];
}

export /*bundle*/ interface IBatch {
	id: string;
	outcome: 'completed' | 'partial' | 'rejected';
	results: IMutationResult[];
}

/**
 * The source operations of the Dev Server over one served root: tree, content, mutations and batches, all
 * expressed in revisions, with every change announced once in the event log.
 */
export /*bundle*/ class Files {
	#root: Root;
	#entries: Entries;
	#mutations: Mutations;
	#sequence = new Sequence();
	#batches = 0;

	#log: Log;
	get log() {
		return this.#log;
	}

	#observer: Observer;
	get observer() {
		return this.#observer;
	}

	constructor(path: string, log = new Log()) {
		this.#root = new Root(path);
		this.#log = log;
		this.#entries = new Entries(this.#root, log);
		this.#mutations = new Mutations(this.#root, this.#entries, log);
		this.#observer = new Observer(
			this.#root,
			paths => this.#sequence.run(async () => {
				for (const path of paths) await this.#entries.examine(path, 'external');
			}),
			() => void this.#sequence.run(async () => {
				// Continuity is lost: a new epoch, and an index rebuilt from disk for whoever resynchronizes
				this.#log.reset('WATCHER');
				await this.#entries.scan(true);
			})
		);
	}

	async start() {
		await this.#sequence.run(() => this.#entries.scan(true));
		this.#observer.start();
	}

	stop() {
		this.#observer.stop();
	}

	/**
	 * @param scan Re-read disk first, which is what polling and manual refresh request
	 */
	tree({ path, scan = false }: { path?: string; scan?: boolean } = {}): Promise<ITree> {
		path && this.#root.validate(path);
		return this.#sequence.run(async () => {
			scan && (await this.#entries.scan());
			return { protocol: 'beyond-dev-files/1', cursor: this.#log.cursor, scanned: scan, entries: this.#entries.list(path) };
		});
	}

	/**
	 * @returns The bytes on disk now, with their revision and the cursor they are consistent with
	 */
	read(path: string): Promise<{ bytes: Buffer; revision: string; cursor: string }> {
		const file = this.#root.resolve(path);
		return this.#sequence.run(async () => {
			const bytes = await fs.readFile(file).catch((): undefined => undefined);
			if (!bytes) throw new DevelopmentError('FILE_NOT_FOUND', `"${path}" does not exist`, 404);
			await this.#entries.examine(path, 'scan');
			return { bytes, revision: Revision.of(bytes), cursor: this.#log.cursor };
		});
	}

	mutate(mutation: IMutation, actor?: IActor, bytes?: Buffer): Promise<IMutationResult> {
		return this.#sequence.run(() => this.#mutations.apply(mutation, actor, {}, bytes));
	}

	/**
	 * Apply mutations in order and stop at the first that does not complete. Not atomic: what completed stays.
	 */
	batch(mutations: IMutation[], actor?: IActor): Promise<IBatch> {
		if (!Array.isArray(mutations) || !mutations.length) throw new DevelopmentError('MUTATION_INVALID', 'A batch needs mutations', 400);
		// Every path is validated before anything is written, so a malformed batch changes nothing
		for (const mutation of mutations) {
			this.#root.resolve(mutation?.path);
			mutation.operation === 'rename' && this.#root.resolve(mutation.to);
		}

		return this.#sequence.run(async () => {
			const id = `bat_${++this.#batches}_${Date.now().toString(36)}`;
			const results: IMutationResult[] = [];
			let stopped = false;
			for (const mutation of mutations) {
				if (stopped) {
					results.push({ outcome: 'skipped', path: mutation.path });
					continue;
				}
				const result = await this.#mutations.apply(mutation, actor, { batch: id });
				results.push(result);
				stopped = result.outcome !== 'completed';
			}
			const completed = results.filter(({ outcome }) => outcome === 'completed').length;
			this.#log.append('batch.completed', { batch: id });
			return { id, outcome: !stopped ? 'completed' : completed ? 'partial' : 'rejected', results };
		});
	}
}
