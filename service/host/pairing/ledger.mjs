import { closeSync, constants, existsSync, fstatSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Store } from '../settings/store.mjs';

/**
 * Where the pairings of a workspace are kept between starts of its service: `<root>/.beyond/pairings.json`, readable
 * by its user only (mode `0600`), in the `.beyond` directory that no file route lists or changes and that ignores
 * itself for Git.
 *
 * The file is `{"protocol": "beyond-dev-pairings/1", "pairings": [{hash, id, origin, created, used, expires,
 * snapshots?}]}`: `hash` is the SHA-256 of a token in hexadecimal, never the token, and the times are ISO 8601. It is
 * written whole through a temporary file and a rename, so a reader never sees a partial one.
 *
 * **Only a file the service could have written is read**, as with the settings: a file that is not a regular file (a
 * symbolic link, a FIFO), that another user owns, or that its group or other users may read or write is read as no
 * pairings, its bytes unread, with the diagnostic `PAIRINGS_FILE_UNTRUSTED`; the next change replaces it. An entry that
 * is not well formed is left out (`PAIRINGS_FILE_INVALID` when the document itself is not one).
 *
 * ```js
 * const ledger = new Ledger(root);
 * const { entries, problem } = ledger.read();
 * ledger.write([{ hash, id, origin, created, used, expires }]);
 * ```
 */
export class Ledger {
	static PROTOCOL = 'beyond-dev-pairings/1';

	/**
	 * The largest file that is read; a larger one is reported and read as no pairings
	 */
	static LIMIT = 1024 * 1024;

	static #FLAGS = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0);
	static #ID = /^prg_[0-9a-f]{12}$/;
	static #HASH = /^[0-9a-f]{64}$/;

	#root;
	#file;
	#identity;

	/**
	 * @param {string} root The canonical root of the workspace
	 * @param {{identity?: {getuid?: () => number}}} [options] Whose files the service writes (tests give their own)
	 */
	constructor(root, { identity = process } = {}) {
		this.#root = root;
		this.#file = join(root, '.beyond', 'pairings.json');
		this.#identity = identity;
	}

	get file() {
		return this.#file;
	}

	/**
	 * The entries the file holds, as `{hash, id, origin, created, used, expires, snapshots?}` with times in milliseconds
	 *
	 * @returns {{entries: object[], problem?: {code: string, message: string}}}
	 */
	read() {
		let descriptor;
		try {
			descriptor = openSync(this.#file, Ledger.#FLAGS);
		} catch (error) {
			if (error.code === 'ENOENT') return { entries: [] };
			if (error.code === 'ELOOP') return Ledger.#untrusted('is a symbolic link');
			return { entries: [], problem: { code: 'PAIRINGS_FILE_INVALID', message: `.beyond/pairings.json could not be read (${error.code ?? error.message}): no pairing was kept` } };
		}
		try {
			const reason = Store.distrust(fstatSync(descriptor), this.#identity);
			if (reason) return Ledger.#untrusted(reason);
			return Ledger.parse(readFileSync(descriptor));
		} catch (error) {
			return { entries: [], problem: { code: 'PAIRINGS_FILE_INVALID', message: `.beyond/pairings.json could not be read (${error.code ?? error.message}): no pairing was kept` } };
		} finally {
			closeSync(descriptor);
		}
	}

	static #untrusted(reason) {
		const message = `.beyond/pairings.json ${reason}, so it is not one this service wrote: it is not read, and every page pairs again. The next pairing replaces it`;
		return { entries: [], problem: { code: 'PAIRINGS_FILE_UNTRUSTED', message } };
	}

	/**
	 * What the bytes of a pairings file hold
	 *
	 * @param {Buffer} bytes
	 */
	static parse(bytes) {
		const invalid = message => ({ entries: [], problem: { code: 'PAIRINGS_FILE_INVALID', message: `.beyond/pairings.json ${message}: no pairing was kept` } });
		if (bytes.length > Ledger.LIMIT) return invalid(`is larger than ${Ledger.LIMIT} bytes`);
		let document;
		try {
			document = JSON.parse(bytes.toString('utf8'));
		} catch {
			return invalid('is not a JSON document');
		}
		if (document?.protocol !== Ledger.PROTOCOL || !Array.isArray(document.pairings)) return invalid(`is not a ${Ledger.PROTOCOL} document`);
		return { entries: document.pairings.map(entry => Ledger.#entry(entry)).filter(Boolean) };
	}

	/**
	 * An entry of the file with its times in milliseconds, or undefined when it is not well formed
	 */
	static #entry(value) {
		const { hash, id, origin, snapshots } = value ?? {};
		const [created, used, expires] = ['created', 'used', 'expires'].map(key => Date.parse(value?.[key]));
		if (typeof hash !== 'string' || !Ledger.#HASH.test(hash) || typeof id !== 'string' || !Ledger.#ID.test(id)) return;
		if (typeof origin !== 'string' || !origin || [created, used, expires].some(Number.isNaN)) return;
		if (snapshots !== undefined && typeof snapshots !== 'string') return;
		return { hash, id, origin, created, used, expires, ...(snapshots ? { snapshots } : {}) };
	}

	/**
	 * Writes the entries whole; no entry removes the file
	 *
	 * @param {{hash: string, id: string, origin: string, created: number, used: number, expires: number, snapshots?:
	 * string}[]} entries
	 */
	write(entries) {
		if (!entries.length) {
			existsSync(this.#file) && rmSync(this.#file, { force: true });
			return;
		}
		const directory = join(this.#root, '.beyond');
		mkdirSync(directory, { recursive: true });
		const ignore = join(directory, '.gitignore');
		existsSync(ignore) || writeFileSync(ignore, '*\n');

		const iso = time => new Date(time).toISOString();
		const pairings = entries.map(({ hash, id, origin, created, used, expires, snapshots }) => ({
			hash,
			id,
			origin,
			created: iso(created),
			used: iso(used),
			expires: iso(expires),
			...(snapshots ? { snapshots } : {})
		}));
		const text = `${JSON.stringify({ protocol: Ledger.PROTOCOL, pairings }, null, '\t')}\n`;
		const temporary = `${this.#file}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
		try {
			writeFileSync(temporary, text, { mode: 0o600 });
			renameSync(temporary, this.#file);
		} catch (error) {
			rmSync(temporary, { force: true });
			throw error;
		}
	}
}
