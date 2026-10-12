import { randomBytes } from 'node:crypto';
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ProductionError } from '../error.mjs';
import { Ignored } from '../ignored.mjs';
import { Tarball } from './tarball.mjs';

/**
 * The registry archives of the workspace's packages, kept where no file route lists or changes them:
 * `<root>/.beyond/production/archives/<id>.tgz` and its record `<id>.json`. An archive is the input of a status check
 * and of a publication, named by its identifier (`arc_<24 hex>`), and expires after `Archives.RETENTION` (24 hours),
 * swept at the start of the service and before each new archive.
 *
 * ```js
 * const archives = new Archives(root);
 * const record = await archives.create(member);     // packs the member
 * const same = await archives.get(record.id);       // the record, or ARCHIVE_NOT_FOUND
 * const bytes = await archives.bytes(record);        // the archive, checked against its record (ARCHIVE_CHANGED)
 * ```
 */
export class Archives {
	static RETENTION = 24 * 3600 * 1000;
	static #ID = /^arc_[0-9a-f]{24}$/;

	#root;
	#directory;
	#clock;
	#retention;

	/**
	 * @param {string} root The canonical root of the workspace
	 * @param {{clock?: {now(): number}, retention?: number}} [options]
	 */
	constructor(root, { clock = Date, retention = Archives.RETENTION } = {}) {
		this.#root = root;
		this.#directory = join(root, '.beyond', 'production', 'archives');
		this.#clock = clock;
		this.#retention = retention;
	}

	/**
	 * Where the archives are written
	 */
	get directory() {
		return this.#directory;
	}

	/**
	 * The file of an archive
	 *
	 * @param {{id: string}} record
	 */
	file({ id }) {
		return join(this.#directory, `${id}.tgz`);
	}

	/**
	 * Removes the archives past their retention
	 */
	async sweep() {
		const names = await readdir(this.#directory).catch(() => []);
		const now = this.#clock.now();
		for (const name of names.filter(one => one.endsWith('.json'))) {
			const record = await this.#read(join(this.#directory, name));
			const created = Date.parse(record?.created ?? '');
			if (record && Number.isFinite(created) && now - created <= this.#retention) continue;
			const id = name.slice(0, -'.json'.length);
			await rm(join(this.#directory, `${id}.tgz`), { force: true });
			await rm(join(this.#directory, name), { force: true });
		}
	}

	async #read(file) {
		try {
			return JSON.parse(await readFile(file, 'utf8'));
		} catch {
			return;
		}
	}

	/**
	 * Packs a member
	 *
	 * @param {{id: string, directory: string, manifest: object, members: string[]}} member
	 * @returns {Promise<{id: string, member: string, name: string, version: string, size: number, integrity: string,
	 * shasum: string, files: string[], excluded: object, created: string}>}
	 */
	async create(member) {
		await this.sweep();
		await mkdir(this.#directory, { recursive: true });
		await Ignored.ensure(this.#root);
		const id = `arc_${randomBytes(12).toString('hex')}`;
		const { manifest, members, directory } = member;
		const packed = await new Tarball(directory, { manifest, members }).write(this.file({ id }));
		const record = {
			id,
			member: member.id,
			name: manifest.name,
			version: manifest.version,
			...packed,
			created: new Date(this.#clock.now()).toISOString()
		};
		await writeFile(join(this.#directory, `${id}.json`), `${JSON.stringify(record, null, '\t')}\n`, { mode: 0o600 });
		return record;
	}

	/**
	 * The record of an archive, for a member when one is given
	 *
	 * @param {unknown} id
	 * @param {string} [member] The member id the archive must have been made from
	 * @throws {ProductionError} `ARCHIVE_NOT_FOUND`
	 */
	async get(id, member) {
		const missing = () => new ProductionError('ARCHIVE_NOT_FOUND', `There is no archive "${String(id).slice(0, 64)}"${member ? ` of the package "${member}"` : ''}: pack it again`);
		if (typeof id !== 'string' || !Archives.#ID.test(id)) throw missing();
		const record = await this.#read(join(this.#directory, `${id}.json`));
		if (!record || (member !== undefined && record.member !== member)) throw missing();
		const present = await stat(this.file(record)).catch(() => void 0);
		if (!present) throw missing();
		return record;
	}

	/**
	 * The bytes of an archive, read again and compared with its record
	 *
	 * @param {{id: string, integrity: string}} record
	 * @throws {ProductionError} `ARCHIVE_CHANGED`
	 */
	async bytes(record) {
		const bytes = await readFile(this.file(record));
		if (Tarball.digests(bytes).integrity !== record.integrity) {
			throw new ProductionError('ARCHIVE_CHANGED', `The archive "${record.id}" is not the one that was packed: pack it again`);
		}
		return bytes;
	}
}
