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

	get body() {
		return { error: { code: this.#code, message: this.message } };
	}

	constructor(code: string, message: string, status: number) {
		super(message);
		this.name = 'DevelopmentError';
		this.#code = code;
		this.#status = status;
	}
}
