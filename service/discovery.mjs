import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

/**
 * The version of the record and of the lifecycle it describes. A service of another protocol is not reused.
 */
export const PROTOCOL = 'beyond-dev-service/1';

const alive = pid => {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return error.code === 'EPERM';
	}
};

/**
 * How the commands of different terminals find the service of a workspace, and how they avoid starting two.
 *
 * A record is keyed by what makes a service reusable: the canonical workspace root, the protocol and the
 * toolchain. The caller, its arguments and its terminal are not part of the key. A record is only a hint:
 * whoever reads it validates the live service before using it, and a record whose process is gone is
 * removed. Starting is serialized by a lock directory, which is atomic to create on every platform; a lock
 * whose holder died is taken over.
 */
export class Discovery {
	#directory;
	#key;

	get key() {
		return this.#key;
	}

	/**
	 * @param {import('./home.mjs').Home} home
	 * @param {{root: string, toolchain: string}} identity
	 */
	constructor(home, { root, toolchain }) {
		this.#directory = home.directory('services');
		this.#key = createHash('sha256').update(JSON.stringify([PROTOCOL, root, toolchain])).digest('hex').slice(0, 20);
	}

	get file() {
		return join(this.#directory, `${this.#key}.json`);
	}

	/**
	 * The record of a service whose process exists. A record left by a dead service is removed.
	 *
	 * @returns {{pid: number, origin: string, root: string, toolchain: string, protocol: string, token?: string} | undefined}
	 */
	read() {
		let record;
		try {
			record = JSON.parse(readFileSync(this.file, 'utf8'));
		} catch {
			return;
		}

		if (record?.protocol === PROTOCOL && Number.isInteger(record.pid) && alive(record.pid)) return record;
		this.remove(record?.pid);
	}

	/**
	 * Publishes the record atomically, so a reader never sees a partial file
	 */
	write(record) {
		const temporary = `${this.file}.${process.pid}.tmp`;
		writeFileSync(temporary, JSON.stringify({ protocol: PROTOCOL, ...record }, null, '\t'), { mode: 0o600 });
		renameSync(temporary, this.file);
	}

	/**
	 * Removes the record, unless it now belongs to another service
	 *
	 * @param {number} [pid] The service whose record is removed
	 */
	remove(pid) {
		try {
			const current = JSON.parse(readFileSync(this.file, 'utf8'));
			if (pid !== undefined && current?.pid !== pid) return;
		} catch {
			// An unreadable record is removed as well
		}
		rmSync(this.file, { force: true });
	}

	/**
	 * Runs a task while holding the start lock of this workspace
	 *
	 * @param {() => Promise<T>} task
	 * @param {{timeout?: number}} [options] How long to wait for another starter
	 * @returns {Promise<T>}
	 * @template T
	 */
	async exclusive(task, { timeout = 120000 } = {}) {
		const lock = join(this.#directory, `${this.#key}.lock`);
		const holder = join(lock, 'holder.json');
		const deadline = Date.now() + timeout;

		for (;;) {
			try {
				mkdirSync(lock);
				writeFileSync(holder, JSON.stringify({ pid: process.pid }));
				break;
			} catch (error) {
				if (error.code !== 'EEXIST') throw error;
			}

			// The holder died, or never finished taking the lock: it is taken over
			let abandoned;
			try {
				abandoned = !alive(JSON.parse(readFileSync(holder, 'utf8')).pid);
			} catch {
				abandoned = Date.now() - (statSync(lock, { throwIfNoEntry: false })?.mtimeMs ?? 0) > 5000;
			}
			if (abandoned) rmSync(lock, { recursive: true, force: true });
			else if (Date.now() > deadline) throw new Error(`Timed out waiting for another command to start the service (${lock})`);
			else await sleep(100);
		}

		try {
			return await task();
		} finally {
			rmSync(lock, { recursive: true, force: true });
		}
	}
}
