/**
 * A refusal of the development contract, in the error envelope shared with the compiled-module contract.
 */
export /*bundle*/ class DevelopmentError extends Error {
	#code: string;
	get code() {
		return this.#code;
	}

	#status: number;
	get status() {
		return this.#status;
	}

	#details: Record<string, unknown>;

	get body() {
		return { error: { code: this.#code, message: this.message, ...this.#details } };
	}

	/**
	 * @param details What lets a client correct the request, such as the values it may choose from
	 */
	constructor(code: string, message: string, status: number, details: Record<string, unknown> = {}) {
		super(message);
		this.name = 'DevelopmentError';
		this.#code = code;
		this.#status = status;
		this.#details = details;
	}
}
