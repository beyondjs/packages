/**
 * A service that could not be started or used as it is, with where its output was logged
 */
export class ServiceError extends Error {
	/**
	 * @param {string} message
	 * @param {string} [log] The log of the service
	 * @param {string} [code] `SERVICE_START_FAILED`, `SERVICE_START_TIMEOUT`, `SERVICE_NOT_ANSWERING` or
	 * `SERVICE_EXTENSIONS_MISSING`
	 */
	constructor(message, log, code = 'SERVICE_START_FAILED') {
		super(message);
		this.name = 'ServiceError';
		this.code = code;
		this.log = log;
	}
}

/**
 * A service that is running and does not admit this client
 */
export class AccessError extends Error {
	constructor(message) {
		super(message);
		this.name = 'AccessError';
		this.code = 'SERVICE_ACCESS_REFUSED';
	}
}

/**
 * A service that is there but did not answer: within the deadline, or at all because the connection ended
 * before the answer. A slow answer is not a wrong one: the record of a service that is alive must not be
 * discarded, and a second service must not be started.
 *
 * A request that changes something and got no answer may have been carried out all the same: its outcome is
 * unknown, which the message says, with how to find it out, instead of inviting a blind repetition.
 */
export class TimeoutError extends Error {
	/**
	 * @param {string} origin
	 * @param {number} deadline Milliseconds
	 * @param {{path?: string, method?: string, variable?: string, check?: string, dropped?: string}} [request]
	 * The request that was not answered, its method, the variable that bounds it, for a request that changes
	 * something how to learn whether it was carried out, and why the connection ended when it did before the
	 * deadline; without a path, the first description of the service
	 */
	constructor(origin, deadline, { path, method = 'GET', variable = 'BEYOND_SESSION_TIMEOUT', check, dropped } = {}) {
		const what = path ? `answer ${method} ${path}` : 'describe itself';
		const when = dropped ? `: the connection ended before its answer (${dropped})` : ` within ${deadline}ms. Raise ${variable} if the host is slow`;
		const unknown = check ? `. Whether it was carried out is unknown: ${check}` : '';
		super(`The development service at ${origin} did not ${what}${when}${unknown}`);
		this.name = 'TimeoutError';
		this.code = 'SERVICE_NOT_ANSWERING';
		this.path = path;
		this.method = method;

		/**
		 * `unknown` for a change that got no answer, `none` for a read
		 */
		this.outcome = check ? 'unknown' : 'none';
	}
}

/**
 * A request whose caller stopped waiting for it, through its own signal. It is the caller's decision, not a service
 * that did not answer. A request that changes something and was sent may have reached the service and been carried
 * out all the same: its outcome is unknown, which the message says, with how to find it out; one stopped before it
 * was sent changed nothing.
 */
export class AbortError extends Error {
	/**
	 * @param {string} origin
	 * @param {{path: string, method?: string, check?: string, sent?: boolean, reason?: unknown}} request The request,
	 * its method, for a request that changes something how to learn whether it was carried out, whether it was sent,
	 * and the reason the caller gave its signal
	 */
	constructor(origin, { path, method = 'GET', check, sent = true, reason }) {
		const unknown = sent && check ? `. Whether it was carried out is unknown: ${check}` : '';
		const when = sent ? '' : ' before it was sent';
		super(`The wait for ${method} ${path} of the development service at ${origin} was stopped by its caller${when}${unknown}`);
		this.name = 'AbortError';
		this.code = 'REQUEST_ABORTED';
		this.path = path;
		this.method = method;
		this.cause = reason;

		/**
		 * `unknown` for a change that was sent, `none` for a read or a request that was never sent
		 */
		this.outcome = sent && check ? 'unknown' : 'none';
	}
}

/**
 * How a request that failed before its answer ended, as a client tells it apart: a bound that expired, a
 * connection nothing accepted (the request never reached a service), or a connection that ended on its way.
 */
export class Transport {
	/**
	 * Whether the request was ended by its own bound
	 */
	static expired(error) {
		return error?.name === 'TimeoutError' || error?.name === 'AbortError' || error?.code === 'ABORT_ERR';
	}

	/**
	 * Whether nothing accepted the connection, so the request is known not to have reached any service
	 */
	static refused(error) {
		const { cause } = error ?? {};
		if (cause?.code === 'ECONNREFUSED') return true;
		return Array.isArray(cause?.errors) && cause.errors.length > 0 && cause.errors.every(({ code }) => code === 'ECONNREFUSED');
	}

	/**
	 * Why a connection ended, for a report
	 */
	static reason(error) {
		return error?.cause?.code ?? error?.cause?.message ?? error?.message ?? String(error);
	}
}
