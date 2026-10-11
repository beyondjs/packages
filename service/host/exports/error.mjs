/**
 * A refusal or a failure of `beyond-dev-exports/1`, with the status of its answer and a stable code:
 *
 * | Code | Status | Meaning |
 * | --- | --- | --- |
 * | `EXPORT_PACKAGE_INVALID` | 400 | A path that is neither `.` (the root package) nor the directory of a member inside the root |
 * | `EXPORT_TRANSFER_INVALID` | 400 | A transfer without a capture, or whose grants are not one per package to send |
 * | `EXPORT_DESTINATION` | 403 | An upload address outside the allowed Snapshots origins, or one that redirects |
 * | `EXPORT_NOT_FOUND` | 404 | No export with that identifier, or one that expired |
 * | `EXPORT_CONFLICT` | 409 | A transfer while another one of the same export runs, or of an export that failed |
 * | `EXPORT_TOO_LARGE` | 413 | A package past the bounds of one archive (recorded in a failed export) |
 * | `EXPORT_CHANGED` | — | The bytes of an archive are not the ones exported (recorded for a package of a transfer) |
 */
export class ExportError extends Error {
	static STATUSES = Object.freeze({
		EXPORT_PACKAGE_INVALID: 400,
		EXPORT_TRANSFER_INVALID: 400,
		EXPORT_DESTINATION: 403,
		EXPORT_NOT_FOUND: 404,
		EXPORT_CONFLICT: 409,
		EXPORT_TOO_LARGE: 413,
		EXPORT_CHANGED: 409,
		EXPORT_FAILED: 500
	});

	#code;
	get code() {
		return this.#code;
	}

	get status() {
		return ExportError.STATUSES[this.#code] ?? 500;
	}

	/**
	 * The error as a document of an export or of an answer: `{code, message}`
	 */
	get described() {
		return { code: this.#code, message: this.message };
	}

	/**
	 * @param {string} code
	 * @param {string} message
	 */
	constructor(code, message) {
		super(message);
		this.name = 'ExportError';
		this.#code = code;
	}
}
