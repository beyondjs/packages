/**
 * Why an archive was refused. It travels through the streams as an error and leaves the module as a
 * diagnostic value: the public API never throws it.
 */
export class Refusal extends Error {
	readonly code: string;

	constructor(code: string, message: string) {
		super(message);
		this.code = code;
	}
}
