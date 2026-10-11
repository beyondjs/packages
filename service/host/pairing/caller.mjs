import { Pairings } from './pairings.mjs';

/**
 * Who sent one request to a service that pairs, and what that caller may do. The policy of the host decides it
 * before anything else runs and leaves it on the request under `Caller.KEY`, a registered symbol, which is how the
 * development extension and the routes of the host read the same decision without a store of their own.
 *
 * On the API listener:
 *
 * - `local`: a local tool, the command line, that presents the service's local credential (`Authorization: Local`).
 *   Everything.
 * - `paired`: a browser page that presents a valid token (`Authorization: Bearer`) from the origin it was paired
 *   from. Everything.
 * - `consumer`: a process of this machine without the credential (BEE Node, a Node consumer): no `Origin`, no
 *   `Sec-Fetch-Site`, a loopback remote address and `Host`, and no public origin configured. Reads only:
 *   `session.read`, `inspect.read`, `artifacts.read` and `events.subscribe`, the events without the sources'.
 * - `visitor`: anyone else, refused everything but pairing a page and the static files of the interface, with the
 *   reason its token, or its lack of a credential, gives.
 *
 * On the preview listener everyone is a `previewer`: `artifacts.read` and `events.subscribe`, build events only.
 *
 * ```js
 * const caller = Caller.of(request);
 * caller?.refusal('files.write');   // undefined, or {status, code, message}
 * caller?.ended(reason => {});      // a paired caller is told when its pairing ends
 * ```
 */
export class Caller {
	/**
	 * The property of a request where the decision is left
	 */
	static KEY = Symbol.for('beyond.caller');

	/**
	 * The capabilities of the callers that do not have every one
	 */
	static CAPABILITIES = Object.freeze({
		consumer: Object.freeze(['session.read', 'inspect.read', 'artifacts.read', 'events.subscribe']),
		previewer: Object.freeze(['artifacts.read', 'events.subscribe']),
		visitor: Object.freeze([])
	});

	/**
	 * The answer to a process of this machine that changes something, or reads behind a public origin, without the
	 * local credential
	 */
	static CREDENTIAL = Object.freeze({
		status: 401,
		code: 'CREDENTIAL_REQUIRED',
		message: 'This request needs the local credential of the development service (Authorization: Local), which the command line of the machine where it runs sends'
	});

	#kind;
	#refusal;
	#pairing;
	#observe;
	#leave;

	/**
	 * @param {'local' | 'paired' | 'consumer' | 'visitor' | 'previewer'} kind
	 * @param {{refusal?: {status: number, code: string, message: string}, pairing?: object, observe?: Function,
	 * leave?: Function}} [details] Why a caller lacks a capability (what its token answered, `PAIRING_REQUIRED` without
	 * one, `CREDENTIAL_REQUIRED` for a process) and, for a paired caller, its pairing, how to observe its end and how to
	 * end it
	 */
	constructor(kind, { refusal = Pairings.refusal('PAIRING_REQUIRED'), pairing, observe, leave } = {}) {
		this.#kind = kind;
		this.#refusal = refusal;
		this.#pairing = pairing;
		this.#observe = observe;
		this.#leave = leave;
	}

	get kind() {
		return this.#kind;
	}

	/**
	 * The pairing of a paired caller: `{id, origin, created, expires}`
	 */
	get pairing() {
		return this.#pairing;
	}

	/**
	 * Whether the caller holds a capability
	 *
	 * @param {string} capability
	 */
	allows(capability) {
		return !Caller.CAPABILITIES[this.#kind] || Caller.CAPABILITIES[this.#kind].includes(capability);
	}

	/**
	 * Why the caller does not hold a capability, as an HTTP answer says it; undefined when it does
	 *
	 * @param {string} capability
	 * @returns {{status: number, code: string, message: string} | undefined}
	 */
	refusal(capability) {
		if (this.allows(capability)) return;
		return { ...this.#refusal };
	}

	/**
	 * Calls back once when the pairing of a paired caller ends, with `PAIRING_EXPIRED` or `PAIRING_REVOKED`
	 *
	 * @param {(reason: string) => void} listener
	 * @returns {() => void} Stops observing
	 */
	ended(listener) {
		return this.#observe ? this.#observe(listener) : () => void 0;
	}

	/**
	 * Ends the pairing of a paired caller, as its page asks
	 *
	 * @returns {boolean} Whether a pairing ended
	 */
	leave() {
		return !!this.#leave?.();
	}

	/**
	 * Leaves the decision on a request
	 *
	 * @param {object} request
	 */
	attach(request) {
		request[Caller.KEY] = this;
	}

	/**
	 * The decision left on a request, undefined on a service that does not pair
	 *
	 * @param {object} request
	 * @returns {Caller | undefined}
	 */
	static of(request) {
		return request?.[Caller.KEY];
	}
}
