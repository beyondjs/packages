import { ExportError } from './error.mjs';
import { Loopback } from './loopback.mjs';
import { Upload } from './upload.mjs';

/**
 * One transfer of an export to a pending Snapshots capture (`POST /exports/:id/transfer`): each archive is sent with
 * its own upload grant, at most as many at once as the service's slots allow, and every change of a package's state
 * (`queued`, `uploading`, `stored`, `failed`, `unknown`) is written to the record and announced before the next.
 *
 * A request names the capture and the grants: one per package that is not stored for that capture yet (every package
 * on the first transfer, the ones that are not `stored` on a later one), or nothing starts. A grant's `upload` must be
 * exactly `<origin>/v1/captures/<capture id>/archive?package=<path>`, for an allowed Snapshots origin
 * (`BEYOND_SNAPSHOTS_ORIGINS`) that is https, or http on a loopback name (`127.0.0.1`, `[::1]`, `localhost` and every
 * name under it), and that capture and package; anything else is `EXPORT_DESTINATION`. The grants stay in this
 * object's memory and are gone with it.
 *
 * ```js
 * const transfer = Transfer.prepare(record, body, { origins });   // validates, or throws ExportError
 * transfer.start({ archives, slots, timeout, save });
 * transfer.cancel();
 * ```
 */
export class Transfer {
	#record;
	#grants;
	#controller = new AbortController();
	#done;

	/**
	 * Settles when every package of the transfer has an outcome
	 */
	get done() {
		return this.#done;
	}

	constructor(record, grants) {
		this.#record = record;
		this.#grants = grants;
	}

	static #invalid(message) {
		return new ExportError('EXPORT_TRANSFER_INVALID', message);
	}

	/**
	 * Checks a request against its export, and gives the transfer that it asks for
	 *
	 * @param {object} record The export
	 * @param {unknown} body `{capture: {id}, grants: [{path, upload, token, expires}]}`
	 * @param {{origins: string[]}} options The allowed Snapshots origins
	 * @returns {Transfer}
	 * @throws {ExportError} `EXPORT_TRANSFER_INVALID`, `EXPORT_DESTINATION`, `EXPORT_CONFLICT`
	 */
	static prepare(record, body, { origins }) {
		if (record.state !== 'ready') throw new ExportError('EXPORT_CONFLICT', 'An export that failed cannot be transferred');
		const capture = body?.capture?.id;
		if (typeof capture !== 'string' || !capture || capture.length > 128) throw Transfer.#invalid('A transfer names the capture it uploads to: {capture: {id}}');
		const { grants } = body;
		if (!Array.isArray(grants)) throw Transfer.#invalid('A transfer gives one grant per package: {grants: [{path, upload, token, expires}]}');

		const paths = record.packages.map(({ path }) => path);
		const named = new Map();
		for (const grant of grants) {
			const { path, upload, token, expires } = grant ?? {};
			if (!paths.includes(path)) throw Transfer.#invalid(`A grant names "${path}", which is not a package of this export`);
			if (named.has(path)) throw Transfer.#invalid(`Two grants name "${path}"`);
			if (typeof token !== 'string' || !token || token.length > 4096) throw Transfer.#invalid(`The grant of "${path}" has no token`);
			if (expires !== undefined && Number.isNaN(Date.parse(expires))) throw Transfer.#invalid(`The grant of "${path}" expires at "${expires}", which is not a time`);
			Transfer.#destination(upload, { path, capture }, origins);
			named.set(path, { path, upload, token, expires });
		}

		// A package already stored for this capture keeps its state; any other one needs a grant
		const same = record.capture?.id === capture;
		const kept = same ? (record.transfer?.packages ?? []).filter(({ state }) => state === 'stored').map(({ path }) => path) : [];
		const missing = paths.filter(path => !kept.includes(path) && !named.has(path));
		if (missing.length) throw Transfer.#invalid(`Each package gets exactly one grant; missing: ${missing.join(', ')}`);
		return new Transfer({ ...record, capture: { id: capture } }, { named, kept });
	}

	/**
	 * Whether an address is https, or http on a loopback name
	 *
	 * @param {URL} url
	 */
	static secure(url) {
		return url.protocol === 'https:' || (url.protocol === 'http:' && Loopback.is(url.hostname));
	}

	/**
	 * Refuses an upload address that is not exactly the archive route of this capture and package on an allowed
	 * Snapshots origin
	 */
	static #destination(upload, { path, capture }, origins) {
		let url;
		try {
			url = new URL(upload);
		} catch {
			throw Transfer.#invalid(`The grant of "${path}" names no upload address`);
		}
		if (!Transfer.secure(url) || !origins.includes(url.origin)) {
			const allowed = origins.length ? `one of ${origins.join(', ')}` : 'none is configured (BEYOND_SNAPSHOTS_ORIGINS)';
			throw new ExportError('EXPORT_DESTINATION', `The upload address of "${path}" is not on an allowed Snapshots origin: ${allowed}`);
		}
		const exact =
			url.pathname === `/v1/captures/${encodeURIComponent(capture)}/archive` &&
			[...url.searchParams.keys()].join() === 'package' &&
			url.searchParams.get('package') === path &&
			!url.hash && !url.username && !url.password;
		if (!exact) {
			throw new ExportError('EXPORT_DESTINATION', `The upload address of "${path}" is not the archive route of capture ${capture} and this package (/v1/captures/<capture>/archive?package=<path>)`);
		}
	}

	/**
	 * The record as the transfer begins: the capture it uploads to, and each package queued or kept as stored
	 */
	get record() {
		const { named, kept } = this.#grants;
		const packages = this.#record.packages.map(({ path }) => ({ path, state: kept.includes(path) && !named.has(path) ? 'stored' : 'queued' }));
		return { ...this.#record, transfer: { packages } };
	}

	/**
	 * Sends every queued package, writing each change of state through `save`
	 *
	 * @param {{archives: Map<string, {file: string, digest: string, bytes: number}>, slots: import('./slots.mjs').Slots,
	 * timeout: number, save: (path: string, state: object) => Promise<void>}} context
	 */
	start({ archives, slots, timeout, save }) {
		const queued = [...this.#grants.named.values()];
		const signal = this.#controller.signal;
		const send = async grant => {
			if (signal.aborted) return;
			if (grant.expires !== undefined && Date.parse(grant.expires) <= Date.now()) {
				return save(grant.path, { state: 'failed', error: { code: 'GRANT_EXPIRED', message: 'The upload grant of this package expired before it was sent: ask Snapshots for new grants' } });
			}
			await save(grant.path, { state: 'uploading' });
			const outcome = await new Upload(archives.get(grant.path), grant, { timeout, signal }).send();
			if (!signal.aborted) await save(grant.path, outcome);
		};
		this.#done = Promise.all(queued.map(grant => slots.run(() => send(grant)))).then(() => void 0);
		return this.#done;
	}

	/**
	 * Stops the transfer: what was not sent is not, and what is being sent is ended
	 */
	cancel() {
		this.#controller.abort();
	}
}
