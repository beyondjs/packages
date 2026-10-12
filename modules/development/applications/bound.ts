/**
 * How long the resolution of an execution target waits for the builds it reads (`BEYOND_TARGET_BUILD_TIMEOUT`, in
 * milliseconds, 30 s by default): the build of its entry and the composition of its graph. Past it the resolution
 * answers what it knows (`build: {state: 'pending'}`) instead of waiting, and the build goes on: the next resolution
 * finds it done. The bound is under the launches' wait for a resolution (`BEYOND_WORKSPACE_TIMEOUT` and 5 s) and a
 * client's wait for an answer (`BEYOND_REQUEST_TIMEOUT`), so a first build of a large entry never makes either of them
 * report the service as unavailable.
 *
 * ```ts
 * const bound = new Bound(process.env);
 * const raced = await bound.race(delivery.module(module, conditions));   // {expired: false, value} or {expired: true}
 * ```
 */
export class Bound {
	static VARIABLE = 'BEYOND_TARGET_BUILD_TIMEOUT';
	static TIMEOUT = 30000;

	#milliseconds: number;

	get milliseconds(): number {
		return this.#milliseconds;
	}

	/**
	 * @param environment Where the variable is read, once; an empty or invalid value is the default
	 */
	constructor(environment: NodeJS.ProcessEnv = process.env) {
		const configured = Number(environment[Bound.VARIABLE]);
		this.#milliseconds = Number.isInteger(configured) && configured > 0 ? configured : Bound.TIMEOUT;
	}

	/**
	 * What a promise settles with, or that the bound passed first. A promise that rejects after the bound is settled
	 * here, never left unhandled.
	 */
	async race<T>(promise: Promise<T>): Promise<{ expired: true } | { expired: false; value: T }> {
		let timer: ReturnType<typeof setTimeout>;
		const expired = new Promise<{ expired: true }>(resolve => (timer = setTimeout(() => resolve({ expired: true }), this.#milliseconds)));
		const settled = promise.then(value => ({ expired: <const>false, value }));
		settled.catch(() => void 0);
		try {
			return await Promise.race([settled, expired]);
		} finally {
			clearTimeout(timer);
		}
	}
}
