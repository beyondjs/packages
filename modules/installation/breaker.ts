import type { SourcesTransport } from '@beyond-js/packages/sources';
import type { Deadline } from './deadline';

/**
 * The transport of one installation, which every request of its resolution and of its fetch goes through.
 *
 * A provider that fails at the network level (no answer within the request's bound, a refused or reset
 * connection, a name that does not resolve) is not asked again during that installation: its later requests fail
 * at once, so an unreachable registry costs one timeout instead of one per package. A destination the underlying
 * transport refuses (`DESTINATION_REFUSED`) is a decision, not an outage, and trips nothing. Once the deadline of
 * the installation passes, the requests still running are aborted and no other one starts.
 */
export class Breaker {
	#deadline: Deadline;
	#transport: SourcesTransport;
	#failed: Map<string, string> = new Map();

	/**
	 * The addresses (scheme, host and port) that failed at the network level, with why they are not requested again
	 */
	get failed(): Map<string, string> {
		return new Map(this.#failed);
	}

	/**
	 * What the providers and the fetch are given to request through
	 */
	get transport(): SourcesTransport {
		return (url: string, init?: RequestInit) => this.#request(url, init);
	}

	/**
	 * @param transport The transport the requests reach the network through; the global `fetch` when absent
	 */
	constructor(deadline: Deadline, transport?: SourcesTransport) {
		this.#deadline = deadline;
		this.#transport = transport || ((url: string, init?: RequestInit) => fetch(url, init));
	}

	async #request(url: string, init: RequestInit = {}): Promise<Response> {
		const { origin, host } = new URL(url);
		const skipped = this.#deadline.expired ? 'the installation ran out of time' : this.#failed.get(origin);
		if (skipped) throw new Error(`${host} was not requested: ${skipped}`);

		// AbortSignal.any is in every Node the toolchain supports (22.21.1 and later), not in its declared types
		const either = (signals: AbortSignal[]): AbortSignal => (<any>AbortSignal).any(signals);
		const bound = this.#deadline.signal;
		const signal = init.signal ? either([init.signal, bound]) : bound;
		try {
			return await this.#transport(url, { ...init, signal });
		} catch (error) {
			const cause = error?.code || error?.name || 'unknown error';
			if (cause !== 'DESTINATION_REFUSED') this.#failed.set(origin, `it could not be reached earlier (${cause})`);
			throw error;
		}
	}
}
