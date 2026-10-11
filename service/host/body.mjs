/**
 * A body that a route does not accept, with the status and code of its answer
 */
export class BodyError extends Error {
	/**
	 * @param {number} status
	 * @param {string} code
	 * @param {string} message
	 */
	constructor(status, code, message) {
		super(message);
		this.name = 'BodyError';
		this.status = status;
		this.code = code;
	}

	/**
	 * The error envelope of the answer
	 */
	get body() {
		return { error: { code: this.code, message: this.message } };
	}
}

/**
 * The JSON body of a request that changes something on a service, read within a size limit.
 *
 * A browser page can send a text body to any origin without asking first, and the service parses nothing it was not
 * sent as `Content-Type: application/json`, which a page of another origin cannot send without a preflight. A request
 * without a body is an empty object when the route allows one.
 *
 * ```js
 * const body = await new Body(request, { limit: 1024 }).read();   // {} for an empty body
 * ```
 */
export class Body {
	#request;
	#limit;
	#empty;

	/**
	 * @param {import('node:http').IncomingMessage} request
	 * @param {{limit: number, empty?: boolean}} options The largest body in bytes, and whether a request without a
	 * body (and then without a type) is an empty object
	 */
	constructor(request, { limit, empty = false }) {
		this.#request = request;
		this.#limit = limit;
		this.#empty = empty;
	}

	/**
	 * @returns {Promise<object>} The parsed object
	 * @throws {BodyError} `415 CONTENT_TYPE_UNSUPPORTED`, `413 BODY_TOO_LARGE` or `400 BODY_INVALID`
	 */
	async read() {
		const request = this.#request;
		const type = String(request.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
		const length = request.headers['content-length'];
		const absent = !type && (length === undefined || length === '0') && request.headers['transfer-encoding'] === undefined;
		if (absent && this.#empty) return {};
		if (type !== 'application/json') {
			const message = `The body of this request is sent as Content-Type: application/json (it was ${type ? `"${type}"` : 'sent without one'})`;
			throw new BodyError(415, 'CONTENT_TYPE_UNSUPPORTED', message);
		}

		const chunks = [];
		let size = 0;
		for await (const chunk of request) {
			if ((size += chunk.length) > this.#limit) throw new BodyError(413, 'BODY_TOO_LARGE', `The body of this request is limited to ${this.#limit} bytes`);
			chunks.push(chunk);
		}

		const text = Buffer.concat(chunks).toString('utf8').trim();
		if (!text && this.#empty) return {};
		let value;
		try {
			value = JSON.parse(text);
		} catch {
			throw new BodyError(400, 'BODY_INVALID', 'The body of this request is not a JSON document');
		}
		if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BodyError(400, 'BODY_INVALID', 'The body of this request must be a JSON object');
		return value;
	}
}
