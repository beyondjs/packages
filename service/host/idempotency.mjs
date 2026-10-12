/**
 * The request identifier (`Idempotency-Key`) of a request that must never be carried out twice, with one rule for every
 * feature of the host that takes one (launches, dependency management, production): 8 to 128 letters, digits, `_`,
 * `.`, `:` or `-`. The same identifier answers what the request it named started. A request that needs one and has
 * none is refused with `400 IDEMPOTENCY_KEY_REQUIRED`, and one whose identifier is malformed, needed or not, with
 * `400 IDEMPOTENCY_KEY_INVALID`; each feature answers them in its own error envelope.
 *
 * ```js
 * const key = new Idempotency(request).key({ required: true, refuse: (code, message) => new LaunchError(code, message) });
 * ```
 */
export class Idempotency {
	static PATTERN = /^[A-Za-z0-9_.:-]{8,128}$/;

	#header;

	/**
	 * @param {{headers: Record<string, string | string[] | undefined>}} request
	 */
	constructor(request) {
		this.#header = request.headers?.['idempotency-key'];
	}

	/**
	 * The request identifier, undefined for a request that has none and does not need one
	 *
	 * @param {{required?: boolean, refuse: (code: string, message: string) => Error, why?: string}} rule Whether the
	 * request needs one, how the feature refuses it, and what repeating the request without one could do
	 * @returns {string | undefined}
	 * @throws {Error} What `refuse` makes of `IDEMPOTENCY_KEY_REQUIRED` or `IDEMPOTENCY_KEY_INVALID`
	 */
	key({ required = false, refuse, why = 'repeating it never carries it out twice' }) {
		if (this.#header === undefined) {
			if (!required) return;
			throw refuse('IDEMPOTENCY_KEY_REQUIRED', `This request carries a request identifier (Idempotency-Key), so that ${why}`);
		}
		if (typeof this.#header !== 'string' || !Idempotency.PATTERN.test(this.#header)) {
			throw refuse('IDEMPOTENCY_KEY_INVALID', 'A request identifier (Idempotency-Key) is 8 to 128 letters, digits, "_", ".", ":" or "-"');
		}
		return this.#header;
	}
}
