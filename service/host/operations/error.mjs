/**
 * A request about operations that the service refuses, with the status and code of its answer
 */
export class OperationError extends Error {
	static STATUS = Object.freeze({
		OPERATION_NOT_FOUND: 404,
		OPERATION_ENDED: 409,
		OPERATION_NOT_CANCELLABLE: 409,
		OPERATION_KIND_INVALID: 400
	});

	/**
	 * @param {string} code
	 * @param {string} message
	 * @param {object} [details]
	 */
	constructor(code, message, details) {
		super(message);
		this.name = 'OperationError';
		this.code = code;
		this.details = details;
	}

	get status() {
		return OperationError.STATUS[this.code] ?? 400;
	}

	/**
	 * The error envelope of the service
	 */
	get body() {
		return { error: { code: this.code, message: this.message, ...(this.details ? { details: this.details } : {}) } };
	}
}
