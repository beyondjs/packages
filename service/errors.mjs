/**
 * A service that could not be started, with where its output was logged
 */
export class ServiceError extends Error {
	/**
	 * @param {string} message
	 * @param {string} [log] The log of the service
	 * @param {string} [code] `SERVICE_START_FAILED`, `SERVICE_START_TIMEOUT` or `SERVICE_NOT_ANSWERING`
	 */
	constructor(message, log, code = 'SERVICE_START_FAILED') {
		super(message);
		this.name = 'ServiceError';
		this.code = code;
		this.log = log;
	}
}
