import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Where the exports of a workspace are kept: `<root>/.beyond/exports/<id>/`, with the record (`export.json`) and one
 * archive per package (`<index>.tar`, in the order of the record). The `.beyond` directory is the state of the
 * service, which no file route lists or changes, and it ignores itself for Git. A record is written whole through a
 * temporary file and a rename, so a reader never sees a partial one, and it never holds an upload grant.
 *
 * ```js
 * const records = new Records(root);
 * await records.write(record);
 * await records.read(id);   // the record, or undefined
 * ```
 */
export class Records {
	static #ID = /^exp_[0-9a-f]{32}$/;

	#root;
	#directory;

	/**
	 * @param {string} root The canonical root of the workspace
	 */
	constructor(root) {
		this.#root = root;
		this.#directory = join(root, '.beyond', 'exports');
	}

	/**
	 * Whether a value can be the identifier of an export, which is what keeps a request inside this directory
	 *
	 * @param {unknown} id
	 */
	static valid(id) {
		return typeof id === 'string' && Records.#ID.test(id);
	}

	/**
	 * The directory of an export
	 *
	 * @param {string} id
	 */
	directory(id) {
		return join(this.#directory, id);
	}

	/**
	 * The archive of the package at an index of an export
	 *
	 * @param {string} id
	 * @param {number} index
	 */
	archive(id, index) {
		return join(this.#directory, id, `${index}.tar`);
	}

	/**
	 * Creates the directory of a new export; the state directory ignores itself for Git, as the service keeps it
	 *
	 * @param {string} id
	 */
	async create(id) {
		await mkdir(this.directory(id), { recursive: true });
		const ignore = join(this.#root, '.beyond', '.gitignore');
		if (!existsSync(ignore)) await writeFile(ignore, '*\n');
	}

	/**
	 * @param {{id: string}} record
	 */
	async write(record) {
		const file = join(this.directory(record.id), 'export.json');
		const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
		await writeFile(temporary, `${JSON.stringify(record, null, '\t')}\n`, { mode: 0o600 });
		await rename(temporary, file);
	}

	/**
	 * @param {string} id
	 * @returns {Promise<object | undefined>} undefined for an export that is not there or whose record cannot be read
	 */
	async read(id) {
		if (!Records.valid(id)) return;
		try {
			return JSON.parse(await readFile(join(this.directory(id), 'export.json'), 'utf8'));
		} catch {
			return;
		}
	}

	/**
	 * The records that can be read, and the identifiers of the directories whose record cannot
	 *
	 * @returns {Promise<{records: object[], unreadable: string[]}>}
	 */
	async list() {
		let names = [];
		try {
			names = await readdir(this.#directory);
		} catch {
			return { records: [], unreadable: [] };
		}
		const records = [];
		const unreadable = [];
		for (const name of names.filter(name => Records.valid(name)).sort()) {
			const record = await this.read(name);
			record ? records.push(record) : unreadable.push(name);
		}
		return { records, unreadable };
	}

	/**
	 * Removes an export and its archives
	 *
	 * @param {string} id
	 */
	async remove(id) {
		if (!Records.valid(id)) return;
		await rm(this.directory(id), { recursive: true, force: true });
	}
}
