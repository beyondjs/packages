import { ServiceError } from './errors.mjs';

/**
 * The outcome of starting one supervisor: the record it publishes once its host is ready, or why it is not.
 *
 * The wait is bounded. A supervisor that reports neither readiness nor a failure within the deadline is
 * stopped, because it was started by this client and nobody else will: it is asked to end, which stops its
 * host and what its preparation started, and its process group is killed if it has not ended after a grace.
 * The outcome is known only once it is gone, so whoever holds the start lock releases it after the cleanup.
 *
 * ```js
 * const record = await new Startup(child, { deadline: 300000, log }).outcome();
 * ```
 */
export class Startup {
	/** How long a supervisor that was asked to end is given before its process group is killed */
	static GRACE = 25000;

	#child;
	#deadline;
	#log;
	#grace;

	/**
	 * @param {import('node:child_process').ChildProcess} child The supervisor, started detached with an IPC
	 * channel, so that it leads its own process group
	 * @param {{deadline: number, log?: string, grace?: number}} options Milliseconds to wait for the outcome,
	 * the log of the service, and the grace of a supervisor that was asked to end
	 */
	constructor(child, { deadline, log, grace = Startup.GRACE }) {
		this.#child = child;
		this.#deadline = deadline;
		this.#log = log;
		this.#grace = grace;
	}

	/**
	 * @returns {Promise<object>} The discovery record of the service that became ready
	 * @throws {ServiceError} `SERVICE_START_FAILED` when the service failed, `SERVICE_START_TIMEOUT` when
	 * it did not become ready within the deadline
	 */
	outcome() {
		const child = this.#child;

		return new Promise((resolve, reject) => {
			let timer;
			const settle = outcome => {
				clearTimeout(timer);
				child.removeAllListeners('message');
				child.removeAllListeners('error');
				child.removeAllListeners('exit');
				child.connected && child.disconnect();
				child.unref();
				outcome();
			};

			child.on('message', ({ ready, failed, log }) =>
				settle(() => (ready ? resolve(ready) : reject(new ServiceError(failed, log ?? this.#log))))
			);
			child.once('error', error => settle(() => reject(new ServiceError(error.message, this.#log))));
			child.once('exit', code => settle(() => reject(new ServiceError(`The service supervisor exited (${code})`, this.#log))));

			timer = setTimeout(async () => {
				// From now on the outcome is this one, whatever the supervisor says or does while it ends
				['message', 'error', 'exit'].forEach(event => child.removeAllListeners(event));
				child.on('error', () => void 0);
				const stopped = await this.#stop();
				const message =
					`The development service did not become ready within ${this.#deadline}ms and was ${stopped}. ` +
					'Raise BEYOND_START_TIMEOUT if the host is slow';
				settle(() => reject(new ServiceError(message, this.#log, 'SERVICE_START_TIMEOUT')));
			}, this.#deadline);
		});
	}

	/**
	 * Ends the supervisor this client started, and nothing else
	 *
	 * @returns {Promise<string>} How it ended, for the report
	 */
	async #stop() {
		const child = this.#child;
		if (this.#ended) return 'stopped';

		const exited = new Promise(resolve => child.once('exit', resolve));
		child.kill('SIGTERM');
		const grace = new Promise(resolve => setTimeout(resolve, this.#grace).unref());
		await Promise.race([exited, grace]);
		if (this.#ended) return 'stopped';

		// The supervisor did not end on its own: its group is the supervisor, its host and their descendants
		try {
			process.platform === 'win32' ? child.kill('SIGKILL') : process.kill(-child.pid, 'SIGKILL');
		} catch {
			// Already gone
		}
		await Promise.race([exited, new Promise(resolve => setTimeout(resolve, 1000).unref())]);
		return 'killed';
	}

	get #ended() {
		return this.#child.exitCode !== null || this.#child.signalCode !== null;
	}
}
