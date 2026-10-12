import { randomBytes } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, rename, rm, rmdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Owner } from '../../operations/owner.mjs';
import { Ignored } from '../ignored.mjs';

/**
 * Where a web export is written before it is moved into its destination: `.beyond/production/staging/<id>`, with the
 * earlier export of the destination moved aside to `<id>.previous` while the new one takes its place, and a journal
 * (`<id>.json`) that names the host writing it (`Owner`) from before anything is staged, and the destination once the
 * moves begin.
 *
 * A service that stopped in the middle leaves them behind, and a later start puts things right (`Staging.recover`): an
 * earlier export moved aside whose destination is empty goes back into place, a new export already in place is kept and
 * recorded from its manifest when it was not, and what was staged is removed. A destination never ends up empty because
 * an export was interrupted. Only what a host that is gone left is recovered: the export another live host on the same
 * root is writing (an exclusive `beyond build` beside a person's service) is left as it is.
 *
 * ```js
 * const staging = new Staging(root, id, owner);
 * await staging.claim();                  // before anything is staged
 * await staging.journal('dist/web');      // before the moves
 * await staging.clear();                  // after them, or after a failure
 * await Staging.recover(root, records);   // when the service starts
 * ```
 */
export class Staging {
	/**
	 * Milliseconds after which what an export staged without a readable journal is taken as abandoned: a journal is
	 * written before anything is staged, so only a writer that predates journals or one that died leaves that
	 */
	static ABANDONED = 60000;

	static #ID = /^exp_[0-9a-f]{24}/;

	#root;
	#id;
	#owner;

	/**
	 * @param {string} root The canonical root of the workspace
	 * @param {string} id The export's identifier
	 * @param {Owner} [owner] The host that writes it
	 */
	constructor(root, id, owner = new Owner()) {
		this.#root = root;
		this.#id = id;
		this.#owner = owner;
	}

	/**
	 * @param {string} root
	 */
	static directory(root) {
		return join(root, '.beyond', 'production', 'staging');
	}

	get path() {
		return join(Staging.directory(this.#root), this.#id);
	}

	/**
	 * Where the earlier export of the destination waits while the new one takes its place
	 */
	get aside() {
		return `${this.path}.previous`;
	}

	/**
	 * Names the host that stages the export, before anything is staged
	 */
	claim() {
		return this.#write({ id: this.#id, owner: this.#owner.toJSON() });
	}

	/**
	 * Records the destination the moves are about
	 *
	 * @param {string} destination Relative to the root
	 */
	journal(destination) {
		return this.#write({ id: this.#id, destination, owner: this.#owner.toJSON() });
	}

	/**
	 * Writes the journal whole, through a temporary file and a rename, so that a host that starts meanwhile never reads
	 * a part of it
	 */
	async #write(content) {
		await mkdir(Staging.directory(this.#root), { recursive: true });
		await Ignored.ensure(this.#root);
		const file = `${this.path}.json`;
		const temporary = `${file}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
		await writeFile(temporary, `${JSON.stringify(content)}\n`);
		await rename(temporary, file);
	}

	/**
	 * Removes what was staged, the earlier export moved aside and the journal
	 */
	async clear() {
		await rm(this.path, { recursive: true, force: true });
		await rm(this.aside, { recursive: true, force: true });
		await rm(`${this.path}.json`, { force: true });
	}

	/**
	 * Puts right what a host that is gone left in the middle of an export, and leaves alone the exports live hosts write
	 *
	 * @param {string} root
	 * @param {{write(record: object): Promise<void>, get(id: string): Promise<object>}} records The export records
	 * @param {Owner} [owner] The host that starts; any other host with the same process identifier is gone
	 */
	static async recover(root, records, owner = new Owner()) {
		const directory = Staging.directory(root);
		const exports = new Map();
		for (const name of await readdir(directory).catch(() => [])) {
			const id = Staging.#ID.exec(name)?.[0];
			id && exports.set(id, [...(exports.get(id) ?? []), name]);
		}

		for (const [id, names] of exports) {
			const journal = await Staging.#journal(directory, id);
			const abandoned = journal ? owner.gone(journal.owner) : await Staging.#idle(directory, names);
			if (!abandoned) continue;
			const staging = new Staging(root, id, owner);
			journal?.destination !== undefined && (await Staging.#restore(root, staging, journal, records));
			await staging.clear();
			await Promise.all(names.filter(name => name.endsWith('.tmp')).map(name => rm(join(directory, name), { force: true })));
		}
		// Removed once nothing is staged there any more
		await rmdir(directory).catch(() => void 0);
	}

	/**
	 * The journal of an export, undefined when there is none or it cannot be read
	 */
	static async #journal(directory, id) {
		try {
			const journal = JSON.parse(await readFile(join(directory, `${id}.json`), 'utf8'));
			return journal && typeof journal === 'object' ? journal : void 0;
		} catch {
			return;
		}
	}

	/**
	 * Whether nothing an export staged without a readable journal changed for `ABANDONED` milliseconds
	 */
	static async #idle(directory, names) {
		const now = Date.now();
		for (const name of names) {
			const { mtimeMs } = (await lstat(join(directory, name)).catch(() => void 0)) ?? {};
			if (mtimeMs !== undefined && now - mtimeMs < Staging.ABANDONED) return false;
		}
		return true;
	}

	/**
	 * An earlier export moved aside goes back into an empty destination; a new export in place is recorded
	 */
	static async #restore(root, staging, journal, records) {
		const destination = join(root, ...String(journal.destination).split('/'));
		const present = await lstat(destination).catch(() => void 0);
		const aside = await lstat(staging.aside).catch(() => void 0);
		if (!present && aside) {
			await mkdir(dirname(destination), { recursive: true });
			await rename(staging.aside, destination);
		}
		if (present) await Staging.#record(destination, journal, records);
	}

	/**
	 * Records the new export a destination holds when its record was not written
	 */
	static async #record(destination, journal, records) {
		try {
			const manifest = JSON.parse(await readFile(join(destination, 'beyond-export.json'), 'utf8'));
			if (manifest.id !== journal.id) return;
			await records.get(journal.id).catch(() => records.write({ ...manifest, destination: journal.destination }));
		} catch {
			// A destination without the manifest of this export holds the earlier one, which keeps its own record
		}
	}
}
