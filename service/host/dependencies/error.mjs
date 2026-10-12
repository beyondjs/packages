/**
 * A request about dependency management that the service refuses, with the status and code of its answer
 */
export class DependencyError extends Error {
	static STATUS = Object.freeze({
		SCOPE_INVALID: 400,
		CHANGES_INVALID: 400,
		BASE_REQUIRED: 400,
		IDEMPOTENCY_KEY_INVALID: 400,
		IDEMPOTENCY_KEY_REQUIRED: 400,
		SCOPE_NOT_FOUND: 404,
		PLAN_NOT_FOUND: 404,
		CHANGE_UNDECLARED: 422,
		PLAN_INVALID: 422,
		DECLARATION_INVALID: 422,
		PLAN_STALE: 409,
		CONTENT_TYPE_UNSUPPORTED: 415,
		HOST_REFUSED: 403,
		ORIGIN_REFUSED: 403
	});

	/**
	 * @param {string} code
	 * @param {string} message
	 * @param {object} [details]
	 */
	constructor(code, message, details) {
		super(message);
		this.name = 'DependencyError';
		this.code = code;
		this.details = details;
	}

	get status() {
		return DependencyError.STATUS[this.code] ?? 400;
	}

	/**
	 * The error envelope of the service
	 */
	get body() {
		return { error: { code: this.code, message: this.message, ...(this.details ? { details: this.details } : {}) } };
	}
}
