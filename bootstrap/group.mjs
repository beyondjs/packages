import { setTimeout as sleep } from 'node:timers/promises';

/**
 * A child process started as the leader of its own process group, and everything it started.
 *
 * The bootstrap servers fork workers that outlive them when only the parent is signalled. Signalling the
 * group reaches all of them, which is what makes stopping a service leave nothing behind.
 */
export class Group {
	#child;

	get pid() {
		return this.#child.pid;
	}

	/**
	 * @param {import('node:child_process').ChildProcess} child A process spawned with `detached: true`
	 */
	constructor(child) {
		this.#child = child;
	}

	get running() {
		return this.#child.exitCode === null && this.#child.signalCode === null;
	}

	#signal(signal) {
		try {
			// A negative pid addresses the process group; Windows has no groups and signals the process
			process.kill(process.platform === 'win32' ? this.pid : -this.pid, signal);
			return true;
		} catch {
			return false;
		}
	}

	/**
	 * Asks the group to end, and forces it after a bounded wait
	 *
	 * @param {number} [grace] Milliseconds before the group is killed
	 */
	async stop(grace = 4000) {
		if (!this.pid || !this.#signal('SIGTERM')) return;

		const deadline = Date.now() + grace;
		while (Date.now() < deadline) {
			if (!this.#signal(0)) return;
			await sleep(100);
		}
		this.#signal('SIGKILL');
	}
}
