/**
 * A refusal or a failure of `beyond-production/1`, with the status of its answer and a stable code. A refusal of a
 * request is answered at once with its status; a failure of the work of an operation is the operation's `error`.
 *
 * | Code | Status | Meaning |
 * | --- | --- | --- |
 * | `MEMBER_NOT_FOUND` | 404 | No member of the workspace has that directory or that name |
 * | `MEMBER_INVALID` | 422 | The member cannot be packed: outside the root, reached through a link, without a manifest naming it |
 * | `MEMBER_AMBIGUOUS` | 409 | Several members have that name: name the member by its directory |
 * | `ARCHIVE_NOT_FOUND` | 404 | No archive with that identifier for this package, or one that expired |
 * | `ARCHIVE_CHANGED` | 409 | The bytes of an archive are not the ones it was made with |
 * | `REQUEST_INVALID` | 400 | A field of the request is missing or malformed |
 * | `IDEMPOTENCY_KEY_REQUIRED`, `IDEMPOTENCY_KEY_INVALID` | 400 | A publication or an export sent without an `Idempotency-Key`; any request with a malformed one |
 * | `CONFIRMATION_MISMATCH` | 422 | The confirmation does not repeat the name, version and registry being published |
 * | `PREFLIGHT_FAILED` | 422 | The package has an error that prevents its publication (it is private, an export is not in its files) |
 * | `VERSION_EXISTS` | 409 | The registry holds this version with other content; a version is never overwritten |
 * | `REGISTRY_REFUSED` | 403 | The registry refused the credentials of this machine (401, 403, a one-time password it asks for) |
 * | `REGISTRY_UNAVAILABLE` | 503 | The registry did not answer within the bound, could not be reached or failed |
 * | `REGISTRY_UNVERIFIABLE` | 502 | The registry answered something that cannot be compared with the archive |
 * | `PUBLISH_FAILED` | 502 | npm failed and the registry does not hold the version: nothing was published |
 * | `PUBLISH_UNKNOWN` | 504 | npm did not answer and the registry could not be read: the version may have been published |
 * | `APPLICATIONS_UNAVAILABLE` | 503 | The catalog of applications cannot resolve execution targets on this service |
 * | `TARGET_NOT_FRONTEND` | 422 | A web export of a target that a browser does not load |
 * | `TARGET_UNRESOLVED` | 422 | The target's entry module could not be resolved |
 * | `EXPORT_DESTINATION_INVALID` | 400 | A destination outside the root, inside `.beyond`, `node_modules`, `.git` or a member's directory |
 * | `EXPORT_DESTINATION_CONFLICT` | 409 | The destination holds files that are not an earlier export of this target, or `replace` was not given |
 * | `EXPORT_STRATEGY_UNSUPPORTED` | 422 | The strategy cannot be honoured here (`cdn` without a CDN origin, or for an installed workspace) |
 * | `EXPORT_GRAPH_INCOMPLETE` | 422 | A module the page needs has no source: unresolved, not on the CDN, or not built |
 * | `EXPORT_PRODUCTION_UNAVAILABLE` | 422 | A module of the page builds no production output |
 * | `EXPORT_NOT_FOUND` | 404 | No export with that identifier |
 */
export class ProductionError extends Error {
	static STATUSES = Object.freeze({
		MEMBER_NOT_FOUND: 404,
		MEMBER_INVALID: 422,
		MEMBER_AMBIGUOUS: 409,
		ARCHIVE_NOT_FOUND: 404,
		ARCHIVE_CHANGED: 409,
		REQUEST_INVALID: 400,
		IDEMPOTENCY_KEY_REQUIRED: 400,
		IDEMPOTENCY_KEY_INVALID: 400,
		CONFIRMATION_MISMATCH: 422,
		PREFLIGHT_FAILED: 422,
		VERSION_EXISTS: 409,
		REGISTRY_REFUSED: 403,
		REGISTRY_UNAVAILABLE: 503,
		REGISTRY_UNVERIFIABLE: 502,
		PUBLISH_FAILED: 502,
		PUBLISH_UNKNOWN: 504,
		APPLICATIONS_UNAVAILABLE: 503,
		APPLICATION_NOT_FOUND: 404,
		TARGET_NOT_FOUND: 404,
		TARGET_NOT_FRONTEND: 422,
		TARGET_UNRESOLVED: 422,
		EXPORT_DESTINATION_INVALID: 400,
		EXPORT_DESTINATION_CONFLICT: 409,
		EXPORT_STRATEGY_UNSUPPORTED: 422,
		EXPORT_GRAPH_INCOMPLETE: 422,
		EXPORT_PRODUCTION_UNAVAILABLE: 422,
		EXPORT_NOT_FOUND: 404
	});

	#code;
	#details;

	get code() {
		return this.#code;
	}

	get details() {
		return this.#details;
	}

	get status() {
		return ProductionError.STATUSES[this.#code] ?? 500;
	}

	/**
	 * The error envelope of an answer
	 */
	get body() {
		return { error: this.described };
	}

	/**
	 * The error as an operation or a record carries it: `{code, message, details?}`
	 */
	get described() {
		return { code: this.#code, message: this.message, ...(this.#details ? { details: this.#details } : {}) };
	}

	/**
	 * @param {string} code
	 * @param {string} message
	 * @param {object} [details] What a client needs to act on it, such as the diagnostics or the export to replace
	 */
	constructor(code, message, details) {
		super(message);
		this.name = 'ProductionError';
		this.#code = code;
		this.#details = details;
	}
}
