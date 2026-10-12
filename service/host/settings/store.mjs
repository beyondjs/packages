import { createHash } from 'node:crypto';
import { closeSync, constants, existsSync, fstatSync, openSync, readFileSync } from 'node:fs';
import { mkdir, open, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Where the local settings of a workspace are kept: `<root>/.beyond/settings.json`, readable by its user only (mode
 * `0600`). The `.beyond` directory is the state of the service, which no file route lists or changes, and it ignores
 * itself for Git, so the settings never enter a versioned declaration.
 *
 * The file is `{"protocol": "beyond-dev-settings/1", "values": {"<key>": <value>, …}}` and holds only what differs
 * from the defaults. Its revision is `sha256-<hex>` of its bytes, the revision of an absent file being the one of no
 * bytes, so a change by hand is a change of revision. It is written whole through a temporary file and a rename, so
 * a reader never sees a partial one.
 *
 * **Only a file the service could have written is read.** A file that is not a regular file (a symbolic link, a FIFO),
 * that another user owns, or that its group or other users may read or write (`mode & 0o077`) is not one the service
 * wrote: a repository that commits one, or another user of the machine, would otherwise choose the executable a launch
 * runs and the variables it receives. It is read as absent, its bytes unread, with the diagnostic
 * `SETTINGS_FILE_UNTRUSTED`, and the first change replaces it with one the service writes. Ownership and modes are POSIX;
 * on Windows the file is read as it is.
 *
 * ```js
 * const store = new Store(root);
 * const { revision, values, problem } = await store.read();
 * await store.write({ 'cdn.origin': 'https://cdn.example.com' });   // the new revision
 * ```
 */
export class Store {
	static PROTOCOL = 'beyond-dev-settings/1';

	/**
	 * The largest settings file that is read; a larger one is reported and read as no values
	 */
	static LIMIT = 4 * 1024 * 1024;

	/**
	 * How the file is opened: never through a symbolic link, and without waiting for a writer when it is a FIFO
	 */
	static #FLAGS = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0);

	#root;
	#file;

	/**
	 * @param {string} root The canonical root of the workspace
	 */
	constructor(root) {
		this.#root = root;
		this.#file = join(root, '.beyond', 'settings.json');
	}

	get file() {
		return this.#file;
	}

	/**
	 * The revision of the bytes of a settings file
	 *
	 * @param {Buffer | string} bytes
	 */
	static revision(bytes) {
		return `sha256-${createHash('sha256').update(bytes).digest('hex')}`;
	}

	/**
	 * What the bytes of a settings file hold
	 *
	 * @param {Buffer | undefined} bytes undefined for an absent file
	 * @returns {{revision: string, values: Record<string, unknown>, problem?: {code: string, message: string}}}
	 */
	static parse(bytes) {
		if (!bytes) return { revision: Store.revision(''), values: {} };
		const revision = Store.revision(bytes);
		const problem = message => ({ revision, values: {}, problem: { code: 'SETTINGS_FILE_INVALID', message: `.beyond/settings.json ${message}` } });
		if (bytes.length > Store.LIMIT) return problem(`is larger than ${Store.LIMIT} bytes and was not read`);

		let document;
		try {
			document = JSON.parse(bytes.toString('utf8'));
		} catch {
			return problem('is not a JSON document');
		}
		const values = document?.values;
		if (!values || typeof values !== 'object' || Array.isArray(values)) return problem('has no "values" object');
		return { revision, values };
	}

	/**
	 * Why a file is not one the service wrote, undefined when it may be
	 *
	 * @param {import('node:fs').Stats} stats Of the file opened
	 * @param {{getuid?: () => number}} [identity] Whose files the service writes: this process's user
	 */
	static distrust(stats, identity = process) {
		if (!stats.isFile()) return 'is not a regular file';
		if (typeof identity.getuid !== 'function') return;
		if (stats.uid !== identity.getuid()) return 'belongs to another user than the one the service runs as';
		if (stats.mode & 0o077) return `can be read or written by other users (mode ${(stats.mode & 0o777).toString(8)})`;
	}

	/**
	 * A file read as absent because the service did not write it
	 *
	 * @param {string} reason
	 */
	static untrusted(reason) {
		const message = `.beyond/settings.json ${reason}, so it is not one this service wrote: it is not read, and the defaults apply. Make it readable by its owner only (chmod 600), or change a setting to replace it`;
		return { revision: Store.revision(''), values: {}, problem: { code: 'SETTINGS_FILE_UNTRUSTED', message } };
	}

	/**
	 * Reads the file
	 *
	 * @throws {Error} When it exists and cannot be read
	 */
	async read() {
		let handle;
		try {
			handle = await open(this.#file, Store.#FLAGS);
		} catch (error) {
			if (error.code === 'ENOENT') return Store.parse();
			if (error.code === 'ELOOP') return Store.untrusted('is a symbolic link');
			throw error;
		}
		try {
			const reason = Store.distrust(await handle.stat());
			return reason ? Store.untrusted(reason) : Store.parse(await handle.readFile());
		} finally {
			await handle.close();
		}
	}

	/**
	 * Reads the file synchronously, as a host that is starting does before its features exist (`Startup`); a file that
	 * cannot be read is read as absent
	 */
	load() {
		let descriptor;
		try {
			descriptor = openSync(this.#file, Store.#FLAGS);
		} catch (error) {
			return error.code === 'ELOOP' ? Store.untrusted('is a symbolic link') : Store.parse();
		}
		try {
			const reason = Store.distrust(fstatSync(descriptor));
			return reason ? Store.untrusted(reason) : Store.parse(readFileSync(descriptor));
		} catch {
			return Store.parse();
		} finally {
			closeSync(descriptor);
		}
	}

	/**
	 * Writes the values whole
	 *
	 * @param {Record<string, unknown>} values
	 * @returns {Promise<string>} The revision of what was written
	 */
	async write(values) {
		const directory = join(this.#root, '.beyond');
		await mkdir(directory, { recursive: true });
		const ignore = join(directory, '.gitignore');
		if (!existsSync(ignore)) await writeFile(ignore, '*\n');

		const text = `${JSON.stringify({ protocol: Store.PROTOCOL, values }, null, '\t')}\n`;
		const temporary = `${this.#file}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
		try {
			await writeFile(temporary, text, { mode: 0o600 });
			await rename(temporary, this.#file);
		} catch (error) {
			await rm(temporary, { force: true });
			throw error;
		}
		return Store.revision(Buffer.from(text, 'utf8'));
	}
}
