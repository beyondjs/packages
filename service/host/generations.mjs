import { ContractError } from '@beyond-js/artifact-api';

/**
 * The generations of the workspace a service hosts: the one it serves, and the one that replaces it after a
 * manifest changed.
 *
 * Reading a workspace is waited for within a bound, at the start and at every reload. A replacement is
 * served only once it is ready, so what is being served never waits for a reload: until then the previous
 * generation answers. Requests that arrive during a reload share it. A reload that fails or does not become
 * ready within the bound is discarded, and the next request tries again; it never leaves the service
 * waiting on a workspace that will not settle.
 *
 * ```js
 * const generations = new Generations(() => new Loaded(settings), { deadline: 120000, log });
 * await generations.start();
 * generations.invalidate();       // a manifest changed
 * await generations.refresh();    // reloads once, shared by whoever asks meanwhile
 * generations.current;            // what is served
 * ```
 *
 * A generation is any object with a `ready` promise and a `destroy()` method.
 */
export class Generations {
	#create;
	#deadline;
	#variable;
	#log;
	#current;
	#pending;
	#wanted = false;
	#reloads = 0;

	/**
	 * The generation that is served
	 */
	get current() {
		return this.#current;
	}

	/**
	 * How many times a reload replaced the served generation
	 */
	get reloads() {
		return this.#reloads;
	}

	/**
	 * @param {() => {ready: Promise<unknown>, destroy: () => void}} create Creates a generation from the
	 * manifests as they are now
	 * @param {{deadline: number, variable?: string, log?: (message: string) => void}} options Milliseconds a
	 * generation is given to become ready, the variable that configures it, and where to report reloads
	 */
	constructor(create, { deadline, variable = 'BEYOND_WORKSPACE_TIMEOUT', log = () => void 0 }) {
		this.#create = create;
		this.#deadline = deadline;
		this.#variable = variable;
		this.#log = log;
	}

	/**
	 * Creates the first generation and waits until it is ready
	 *
	 * @throws {Error} `WORKSPACE_NOT_READY` when it is not ready within the deadline; the generation is destroyed
	 */
	async start() {
		const first = this.#create();
		try {
			await this.#wait(first);
		} catch (error) {
			this.#discard(first);
			if (error !== Generations.#EXPIRED) throw error;

			const message = `The workspace was not read within ${this.#deadline}ms. Raise ${this.#variable} if the host is slow`;
			throw Object.assign(new Error(message), { code: 'WORKSPACE_NOT_READY' });
		}
		this.#current = first;
	}

	/**
	 * Records that the served generation no longer reflects the manifests
	 */
	invalidate() {
		this.#wanted = true;
	}

	/**
	 * Makes the served generation current: waits for a reload in progress, and starts one if the manifests
	 * changed since the last one began
	 *
	 * @throws {ContractError} `UNAVAILABLE` (503) when the reload is not ready within the deadline
	 * @throws {Error} What a reload that failed rejected with
	 */
	async refresh() {
		if (this.#pending) await this.#pending;
		if (!this.#wanted) return;

		this.#pending ??= this.#replace().finally(() => (this.#pending = void 0));
		return this.#pending;
	}

	async #replace() {
		this.#wanted = false;
		this.#log('a manifest changed: reloading the workspace');

		const next = this.#create();
		try {
			await this.#wait(next);
		} catch (error) {
			// The next request tries again; until then the previous generation is served
			this.#wanted = true;
			this.#discard(next);
			if (error !== Generations.#EXPIRED) {
				this.#log(`the reload failed: ${error?.message ?? error}`);
				throw error;
			}

			this.#log(`the reload was not ready within ${this.#deadline}ms: discarded`);
			const message =
				`The workspace is being reloaded after a manifest changed and was not ready within ${this.#deadline}ms. ` +
				`Repeat the request; raise ${this.#variable} if the host is slow`;
			throw new ContractError('UNAVAILABLE', message);
		}

		const previous = this.#current;
		this.#current = next;
		this.#reloads++;
		this.#discard(previous);
	}

	static #EXPIRED = Symbol('expired');

	#wait(generation) {
		let timer;
		const expired = new Promise((resolve, reject) => (timer = setTimeout(() => reject(Generations.#EXPIRED), this.#deadline)));
		return Promise.race([generation.ready, expired]).finally(() => clearTimeout(timer));
	}

	#discard(generation) {
		try {
			generation?.destroy();
		} catch (error) {
			this.#log(`destroying a workspace: ${error.message}`);
		}
	}

	/**
	 * Destroys the served generation
	 */
	destroy() {
		this.#discard(this.#current);
	}
}
