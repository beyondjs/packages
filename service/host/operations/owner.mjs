import { randomBytes } from 'node:crypto';

/**
 * The host that owns what it records on disk while it works: its operations, the application of a plan it runs and an
 * export it stages. It is named by its process identifier and a token chosen when it starts, kept only in its memory
 * and in the records it writes, so a host that starts again is another owner even with the same identifier.
 *
 * Several hosts may serve one root at once: a person's service and the exclusive service of a headless build
 * (`beyond build`). A starting host puts right only what a host that is gone left (`gone`): a record whose owner process
 * no longer exists, one written by an earlier process with this host's own identifier, and one that names no owner. A
 * record of a live owner is never interrupted, reconciled or recovered.
 *
 * ```js
 * const owner = new Owner();
 * const record = { ...work, owner: owner.toJSON() };   // {pid, token}
 * owner.gone(record.owner);                            // false while this host or another live one wrote it
 * ```
 *
 * Limits: the system reuses process identifiers, so a record whose owner died and whose identifier now names another
 * process is taken for a live one until that process ends; it is put right by the first start that finds its owner
 * gone. The identifiers are those of one machine: a root that hosts on several machines serve at once is not supported.
 */
export class Owner {
	#pid;
	#token;

	/**
	 * @param {{pid?: number, token?: string}} [identity] The process and its token; this process and a new token by
	 * default, which a test replaces to stand for another host
	 */
	constructor({ pid = process.pid, token = randomBytes(12).toString('hex') } = {}) {
		this.#pid = pid;
		this.#token = token;
	}

	get pid() {
		return this.#pid;
	}

	/**
	 * What a record names as its owner
	 *
	 * @returns {{pid: number, token: string}}
	 */
	toJSON() {
		return { pid: this.#pid, token: this.#token };
	}

	/**
	 * Whether this host wrote a record
	 *
	 * @param {{pid?: unknown, token?: unknown} | undefined} recorded The owner a record names
	 */
	owns(recorded) {
		return recorded?.pid === this.#pid && recorded?.token === this.#token;
	}

	/**
	 * Whether the host that wrote a record is gone, so that this one may put right what it left
	 *
	 * @param {{pid?: unknown, token?: unknown} | undefined} recorded The owner a record names, undefined for a record
	 * written before owners were recorded
	 */
	gone(recorded) {
		const { pid } = recorded ?? {};
		if (!Number.isInteger(pid) || pid <= 0) return true;
		// This process holds the identifier now: the record is its own, or an earlier process's that had it
		if (pid === this.#pid) return recorded.token !== this.#token;
		try {
			process.kill(pid, 0);
			return false;
		} catch (error) {
			// A process of another user exists all the same (EPERM): only one that is not there is gone
			return error?.code === 'ESRCH';
		}
	}
}
