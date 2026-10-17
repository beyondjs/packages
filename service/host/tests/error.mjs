/**
 * A request about test runs that the service refuses, with the status of its answer and a stable code
 *
 * | Code | Status | When |
 * | --- | --- | --- |
 * | `TESTS_FILES_INVALID` | 400 | `files` names something that is not a test file inside the root |
 * | `TESTS_RUN_NOT_FOUND` | 404 | No run of this service has that identifier |
 * | `TESTS_RUNNING` | 409 | A run is under way (`details.run`): one at a time |
 * | `TESTS_RUN_ENDED` | 409 | The run to cancel already ended |
 * | `TESTS_NOT_FOUND` | 422 | No test file was collected |
 * | `UNAVAILABLE` | 503 | The service does not listen yet, or it is ending |
 */
export class TestsError extends Error {
	static STATUS = Object.freeze({ TESTS_FILES_INVALID: 400, TESTS_RUN_NOT_FOUND: 404, TESTS_RUNNING: 409, TESTS_RUN_ENDED: 409, TESTS_NOT_FOUND: 422, UNAVAILABLE: 503 });

	/**
	 * @param {string} code
	 * @param {string} message
	 * @param {object} [details]
	 */
	constructor(code, message, details) {
		super(message);
		this.name = 'TestsError';
		this.code = code;
		this.details = details;
	}

	get status() {
		return TestsError.STATUS[this.code] ?? 400;
	}

	get body() {
		return { error: { code: this.code, message: this.message, ...(this.details ? { details: this.details } : {}) } };
	}
}
