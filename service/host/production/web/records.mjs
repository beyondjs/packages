import { randomBytes } from 'node:crypto';
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ProductionError } from '../error.mjs';
import { Ignored } from '../ignored.mjs';

/**
 * The web exports of the workspace, as the service made them: each one's manifest and its destination, kept under
 * `<root>/.beyond/production/exports/<id>.json`, which no file route lists or changes, so `GET /production/exports`
 * answers them after a restart. A record is written once its export is in place.
 *
 * ```js
 * const records = new Records(root);
 * await records.write({ ...manifest, destination: 'dist/web' });
 * await records.list();   // newest first
 * ```
 */
export class Records {
	static #ID = /^exp_[0-9a-f]{24}$/;
	static LIMIT = 100;

	#root;
	#directory;

	/**
	 * @param {string} root The canonical root of the workspace
	 */
	constructor(root) {
		this.#root = root;
		this.#directory = join(root, '.beyond', 'production', 'exports');
	}

	/**
	 * @param {{id: string}} record
	 */
	async write(record) {
		await mkdir(this.#directory, { recursive: true });
		await Ignored.ensure(this.#root);
		const file = join(this.#directory, `${record.id}.json`);
		// A temporary file of its own: two hosts that recover the same export never write one file at once
		const temporary = `${file}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
		await writeFile(temporary, `${JSON.stringify(record, null, '\t')}\n`, { mode: 0o600 });
		await rename(temporary, file);
	}

	/**
	 * @param {unknown} id
	 * @throws {ProductionError} `EXPORT_NOT_FOUND`
	 */
	async get(id) {
		const missing = new ProductionError('EXPORT_NOT_FOUND', `There is no export "${String(id).slice(0, 64)}"`);
		if (typeof id !== 'string' || !Records.#ID.test(id)) throw missing;
		try {
			return JSON.parse(await readFile(join(this.#directory, `${id}.json`), 'utf8'));
		} catch {
			throw missing;
		}
	}

	/**
	 * The exports, newest first, at most `Records.LIMIT`
	 */
	async list() {
		const names = (await readdir(this.#directory).catch(() => [])).filter(name => Records.#ID.test(name.replace(/\.json$/, '')) && name.endsWith('.json'));
		const records = [];
		for (const name of names) {
			try {
				records.push(JSON.parse(await readFile(join(this.#directory, name), 'utf8')));
			} catch {
				// A record that cannot be read is not listed
			}
		}
		return records.sort((a, b) => (a.created < b.created ? 1 : a.created > b.created ? -1 : 0)).slice(0, Records.LIMIT);
	}
}
