import type { SourcesTransport } from '@beyond-js/packages/sources';
import type { IInstallationEvent } from './types';
import type { Deadline } from './deadline';

/**
 * Who is told of the requests of one run, and the signal of whoever may stop it
 */
export interface IBreakerOptions {
	// Told each request when it starts and when it was answered or failed; a listener that throws is ignored
	listener?: (request: IInstallationEvent['request']) => void;
	// Aborting it aborts the requests still running and refuses the next ones, as the deadline does
	signal?: AbortSignal;
}

/**
 * The transport of one installation, which every request of its resolution and of its fetch goes through.
 *
 * A provider that fails at the network level (no answer within the request's bound, a refused or reset
 * connection, a name that does not resolve) is not asked again during that installation: its later requests fail
 * at once, so an unreachable registry costs one timeout instead of one per package. A destination the underlying
 * transport refuses (`DESTINATION_REFUSED`) is a decision, not an outage, and trips nothing. Once the deadline of
 * the installation passes, or whoever started it cancels it, the requests still running are aborted and no other
 * one starts.
 */
export class Breaker {
	#deadline: Deadline;
	#transport: SourcesTransport;
	#failed: Map<string, string> = new Map();
	#listener?: IBreakerOptions['listener'];
	#signal?: AbortSignal;

	#requests = { metadata: 0, archive: 0 };
	/**
	 * The requests made so far, package metadata and archives apart
	 */
	get requests(): { metadata: number; archive: number } {
		return { ...this.#requests };
	}

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
	constructor(deadline: Deadline, transport?: SourcesTransport, options: IBreakerOptions = {}) {
		this.#deadline = deadline;
		this.#transport = transport || ((url: string, init?: RequestInit) => fetch(url, init));
		this.#listener = options.listener;
		this.#signal = options.signal;
	}

	/**
	 * Whether a request asks for an archive rather than package metadata: the registry layout of an archive
	 * (`<name>/-/<file>.tgz`) or an address of a compressed tarball
	 */
	static #kind(url: URL): 'metadata' | 'archive' {
		return /\/-\/[^/]+$|\.(tgz|tar\.gz)$/i.test(url.pathname) ? 'archive' : 'metadata';
	}

	#tell(url: URL, kind: 'metadata' | 'archive', answered: boolean): void {
		if (!this.#listener) return;
		try {
			this.#listener({ url: `${url.origin}${url.pathname}`, kind, answered });
		} catch {
			// Whoever listens never changes what the installation does
		}
	}

	async #request(url: string, init: RequestInit = {}): Promise<Response> {
		const parsed = new URL(url);
		const { origin, host } = parsed;
		const cancelled = this.#signal?.aborted && 'it was cancelled';
		const skipped = this.#deadline.expired ? 'the installation ran out of time' : cancelled || this.#failed.get(origin);
		if (skipped) throw new Error(`${host} was not requested: ${skipped}`);

		// AbortSignal.any is in every Node the toolchain supports (22.21.1 and later), not in its declared types
		const either = (signals: AbortSignal[]): AbortSignal => (<any>AbortSignal).any(signals);
		const signals = [init.signal, this.#deadline.signal, this.#signal].filter(signal => !!signal);
		const signal = signals.length > 1 ? either(signals) : signals[0];
		const kind = Breaker.#kind(parsed);
		this.#requests[kind]++;
		this.#tell(parsed, kind, false);
		try {
			return await this.#transport(url, { ...init, signal });
		} catch (error) {
			const cause = error?.code || error?.name || 'unknown error';
			const stopped = this.#signal?.aborted || this.#deadline.expired;
			if (cause !== 'DESTINATION_REFUSED' && !stopped) this.#failed.set(origin, `it could not be reached earlier (${cause})`);
			throw error;
		} finally {
			this.#tell(parsed, kind, true);
		}
	}
}
