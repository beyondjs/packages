/**
 * A request about the local settings that the service refuses, with the status and code of its answer: `428
 * PRECONDITION_REQUIRED`, `403 SETTING_FIXED` (with the `keys` the environment fixes), `422 SETTING_INVALID` (with one
 * diagnostic per key) or `400 BODY_INVALID`
 */
export class SettingsError extends Error {
	#status;
	#code;
	#details;

	/**
	 * @param {number} status
	 * @param {string} code
	 * @param {string} message
	 * @param {object} [details] What lets a client correct the request, such as the diagnostics of each key
	 */
	constructor(status, code, message, details = {}) {
		super(message);
		this.name = 'SettingsError';
		this.#status = status;
		this.#code = code;
		this.#details = details;
	}

	get status() {
		return this.#status;
	}

	get code() {
		return this.#code;
	}

	/**
	 * The error envelope of the service
	 */
	get body() {
		return { error: { code: this.#code, message: this.message, ...this.#details } };
	}
}
