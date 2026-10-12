/**
 * A request about launches that the service refuses, with the status and code of its answer and, when the refusal
 * concerns a launch or a target, what it is about (`details`)
 *
 * | Code | Status | When |
 * | --- | --- | --- |
 * | `LAUNCH_NOT_FOUND` | 404 | No launch of this service has that identifier |
 * | `APPLICATION_NOT_FOUND`, `TARGET_NOT_FOUND` | 404 | The catalog declares no such application or target |
 * | `LAUNCH_RUNNING` | 409 | Another launch of the target runs (`details.launch`) |
 * | `LAUNCH_ENDED` | 409 | The launch to stop already ended (`details.launch`) |
 * | `TARGET_NOT_LAUNCHABLE` | 422 | The target cannot be launched here (`details.reason`: a code) |
 * | `IDEMPOTENCY_KEY_REUSED` | 422 | The request identifier already named a launch of another target |
 * | `IDEMPOTENCY_KEY_REQUIRED`, `IDEMPOTENCY_KEY_INVALID`, `BODY_INVALID`, `OPTION_INVALID` | 400 | A malformed request |
 * | `UNAVAILABLE` | 503 | The service cannot launch now (it does not listen yet, or its catalog cannot answer) |
 */
export class LaunchError extends Error {
	static STATUS = Object.freeze({
		LAUNCH_NOT_FOUND: 404,
		APPLICATION_NOT_FOUND: 404,
		TARGET_NOT_FOUND: 404,
		LAUNCH_RUNNING: 409,
		LAUNCH_ENDED: 409,
		TARGET_NOT_LAUNCHABLE: 422,
		IDEMPOTENCY_KEY_REUSED: 422,
		IDEMPOTENCY_KEY_REQUIRED: 400,
		IDEMPOTENCY_KEY_INVALID: 400,
		BODY_INVALID: 400,
		OPTION_INVALID: 400,
		UNAVAILABLE: 503
	});

	/**
	 * @param {string} code
	 * @param {string} message
	 * @param {object} [details]
	 */
	constructor(code, message, details) {
		super(message);
		this.name = 'LaunchError';
		this.code = code;
		this.details = details;
	}

	/**
	 * A target that cannot be launched here, and why, as a code of `details.reason`
	 *
	 * @param {string} reason
	 * @param {string} message
	 */
	static unlaunchable(reason, message) {
		return new LaunchError('TARGET_NOT_LAUNCHABLE', message, { reason });
	}

	get status() {
		return LaunchError.STATUS[this.code] ?? 400;
	}

	/**
	 * The error envelope of the service
	 */
	get body() {
		return { error: { code: this.code, message: this.message, ...(this.details ? { details: this.details } : {}) } };
	}
}
