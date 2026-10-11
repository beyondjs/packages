import { randomBytes } from 'node:crypto';
import { readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The local credential of a service that pairs browsers: a random secret its supervisor writes at start into the
 * service's directory, readable by its user only (mode 0600), and removes when the service ends. A local tool, the
 * command line, reads it through the discovery record and presents it as `Authorization: Local <credential>`; that is
 * what tells a process of the person from a request that only looks local, such as one a forwarder relays.
 *
 * ```js
 * const credential = Credential.create(directory);   // supervisor
 * Credential.authorization(record.credential);         // client: 'Local …', or undefined
 * credential.remove();
 * ```
 */
export class Credential {
	static FILE = 'credential';

	#file;
	#value;

	/**
	 * The file that holds the secret
	 */
	get file() {
		return this.#file;
	}

	/**
	 * The secret itself
	 */
	get value() {
		return this.#value;
	}

	constructor(file, value) {
		this.#file = file;
		this.#value = value;
	}

	/**
	 * Writes a new credential into a directory, through a temporary file that is created readable by its user only
	 *
	 * @param {string} directory
	 * @returns {Credential}
	 */
	static create(directory) {
		const value = randomBytes(32).toString('base64url');
		const file = join(directory, Credential.FILE);
		const temporary = `${file}.${process.pid}.tmp`;
		writeFileSync(temporary, value, { mode: 0o600 });
		renameSync(temporary, file);
		return new Credential(file, value);
	}

	/**
	 * The `Authorization` a local tool presents, from the file a discovery record names
	 *
	 * @param {string | undefined} file
	 * @returns {string | undefined} undefined when there is no credential to present, or it cannot be read
	 */
	static authorization(file) {
		if (typeof file !== 'string' || !file) return;
		try {
			const value = readFileSync(file, 'utf8').trim();
			return /^[A-Za-z0-9_-]{43}$/.test(value) ? `Local ${value}` : void 0;
		} catch {
			return;
		}
	}

	/**
	 * Removes the file, once the service ends
	 */
	remove() {
		rmSync(this.#file, { force: true });
	}
}
