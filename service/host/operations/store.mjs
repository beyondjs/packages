import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Where the operations of a workspace are kept: one record per operation in `<root>/.beyond/operations/<id>.json`.
 * The `.beyond` directory is the state of the service, which no file route lists or changes, and it ignores itself for
 * Git. A record is written whole through a temporary file and a rename, so a reader never sees a partial one. Records
 * older than the retention, and the oldest past `LIMIT`, are removed when the service starts, except the ones another
 * live host on the same root still runs.
 */
export class Store {
	static #ID = /^op_[0-9a-f]{24}$/;

	/**
	 * Records kept at most, the newest ones
	 */
	static LIMIT = 500;

	#root;
	#directory;

	/**
	 * @param {string} root The canonical root of the workspace
	 */
	constructor(root) {
		this.#root = root;
		this.#directory = join(root, '.beyond', 'operations');
	}

	get directory() {
		return this.#directory;
	}

	/**
	 * Whether a value can be the identifier of an operation, which is what keeps a request inside this directory
	 *
	 * @param {unknown} id
	 */
	static valid(id) {
		return typeof id === 'string' && Store.#ID.test(id);
	}

	async #prepare() {
		await mkdir(this.#directory, { recursive: true });
		const ignore = join(this.#root, '.beyond', '.gitignore');
		if (!existsSync(ignore)) await writeFile(ignore, '*\n');
	}

	/**
	 * @param {{id: string}} record
	 */
	async write(record) {
		await this.#prepare();
		const file = join(this.#directory, `${record.id}.json`);
		const temporary = `${file}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
		await writeFile(temporary, `${JSON.stringify(record, null, '\t')}\n`, { mode: 0o600 });
		await rename(temporary, file);
	}

	/**
	 * @param {string} id
	 * @returns {Promise<object | undefined>} undefined for an operation that is not there or whose record cannot be read
	 */
	async read(id) {
		if (!Store.valid(id)) return;
		try {
			return JSON.parse(await readFile(join(this.#directory, `${id}.json`), 'utf8'));
		} catch {
			return;
		}
	}

	/**
	 * Every record that can be read, newest first
	 *
	 * @returns {Promise<object[]>}
	 */
	async list() {
		let names = [];
		try {
			names = await readdir(this.#directory);
		} catch {
			return [];
		}
		const records = [];
		for (const name of names) {
			const id = name.replace(/\.json$/, '');
			if (!name.endsWith('.json') || !Store.valid(id)) continue;
			const record = await this.read(id);
			record && records.push(record);
		}
		return records.sort((a, b) => String(b.created).localeCompare(String(a.created)));
	}

	/**
	 * Removes the records older than the retention and the oldest past the limit
	 *
	 * @param {number} retention Milliseconds a record is kept after it was created
	 * @param {number} now
	 * @param {(record: object) => boolean} [kept] The records never removed: those a live host still runs
	 */
	async sweep(retention, now, kept = () => false) {
		const records = await this.list();
		const old = records.filter((record, index) => !kept(record) && (index >= Store.LIMIT || now - Date.parse(record.created) > retention));
		for (const record of old) await rm(join(this.#directory, `${record.id}.json`), { force: true });
		// Temporary files of a writer that died
		let names = [];
		try {
			names = await readdir(this.#directory);
		} catch {
			return;
		}
		for (const name of names.filter(one => one.endsWith('.tmp'))) {
			const file = join(this.#directory, name);
			const { mtimeMs } = (await stat(file).catch(() => void 0)) ?? {};
			if (mtimeMs !== undefined && now - mtimeMs > 60000) await rm(file, { force: true });
		}
	}
}
