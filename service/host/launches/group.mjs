/**
 * The process group a launched process leads: it is started detached, so the group holds it and whatever it starts
 * without a group of its own, and a stop reaches all of them. Signals go only to a group this feature created; one
 * whose processes all ended is not signalled, so a group identifier the system gave to another process later is
 * never reached.
 *
 * Process groups are POSIX; on Windows the signal reaches the launched process alone.
 */
export class Group {
	#id;

	/**
	 * @param {number} pid The process that leads the group, whose identifier is the group's
	 */
	constructor(pid) {
		this.#id = pid;
	}

	get id() {
		return this.#id;
	}

	/**
	 * Whether the group still holds a process this one may signal
	 */
	get alive() {
		try {
			process.kill(process.platform === 'win32' ? this.#id : -this.#id, 0);
			return true;
		} catch {
			return false;
		}
	}

	/**
	 * Sends a signal to every process of the group
	 *
	 * @param {NodeJS.Signals} name
	 * @returns {boolean} Whether it was sent; false when the group no longer exists
	 */
	signal(name) {
		try {
			process.kill(process.platform === 'win32' ? this.#id : -this.#id, name);
			return true;
		} catch {
			return false;
		}
	}
}
