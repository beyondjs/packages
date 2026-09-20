import type { IGraphNode } from '@beyond-js/packages/resolution';
import type { IStore, IStoreRecord, ISourceResult, ISourceDiagnostic } from './types';
import type { Limits } from './limits';
import { Readable } from 'stream';
import { Integrity } from './integrity';
import { Archive } from './archive';
import { Refusal } from './refusal';

/**
 * Whoever knows the credentials of the providers: `PackageProviders` of `@beyond-js/packages/providers`
 */
export /*bundle*/ interface IAuthorizer {
	authorize(pkg: string, url: string): Promise<Record<string, string>>;
}

export interface IDownloadOutcome {
	result?: ISourceResult;
	diagnostic?: ISourceDiagnostic;
}

/**
 * Brings one pinned package into the store: reuses the verified source when the store holds it, and
 * otherwise downloads, verifies and publishes it. Whatever fails, the stage is discarded, so the store
 * never holds a partial or unverified source.
 */
export class Download {
	#store: IStore;
	#limits: Limits;
	#authorizer?: IAuthorizer;
	#tenant?: string;

	constructor(store: IStore, limits: Limits, authorizer?: IAuthorizer, tenant?: string) {
		this.#store = store;
		this.#limits = limits;
		this.#authorizer = authorizer;
		this.#tenant = tenant;
	}

	/**
	 * @param node Key of the graph node
	 * @param excepted True when the graph lists the node as an exception: it may publish no integrity
	 */
	async run(node: string, pinned: IGraphNode, excepted: boolean): Promise<IDownloadOutcome> {
		try {
			return { result: await this.#run(node, pinned, excepted) };
		} catch (error) {
			if (error instanceof Refusal) return { diagnostic: { code: error.code, message: error.message, node } };
			return { diagnostic: { code: 'SOURCE_FETCH_FAILED', message: 'The source could not be fetched', node } };
		}
	}

	async #run(node: string, pinned: IGraphNode, excepted: boolean): Promise<ISourceResult> {
		const { name, version, tarball } = pinned;
		const origin = pinned.origin?.provider;
		if (!origin || !name || !version || !/^https?:\/\//.test(tarball || '')) {
			throw new Refusal('NODE_INVALID', `The graph node "${node}" does not describe a downloadable release`);
		}

		// Without a published integrity the content is hashed as it arrives, which is only accepted for
		// the nodes the graph recorded as exceptions
		const established = pinned.integrity === null || pinned.integrity === void 0;
		if (established && !excepted) {
			throw new Refusal(
				'INTEGRITY_MISSING',
				`"${name}@${version}" has no integrity and is not a recorded exception`
			);
		}
		const integrity = new Integrity(established ? 'sha512-' : pinned.integrity);
		if (!established && !integrity.valid) {
			throw new Refusal(
				'INTEGRITY_UNSUPPORTED',
				`The integrity of "${name}@${version}" is not a supported digest`
			);
		}

		// What is downloaded with credentials is private, whatever the graph says
		const headers = (await this.#authorizer?.authorize(name, tarball)) || {};
		const restricted = pinned.visibility !== 'public' || Object.keys(headers).length > 0;
		if (restricted && !this.#tenant) {
			throw new Refusal('TENANT_REQUIRED', `"${name}@${version}" is private: a tenant is required to store it`);
		}
		const scope = restricted ? `org:${this.#tenant}` : 'public';

		const segment = established ? 'established' : integrity.id;
		const record: IStoreRecord = {
			key: [origin, name, version, segment].join('/'),
			scope,
			origin,
			name,
			version,
			integrity: established ? 'established' : pinned.integrity
		};

		const stored = (await this.#store.has(record)) && (await this.#store.get(record));
		if (stored) {
			const { bytes, extracted, entries } = stored;
			const result = { node, key: record.key, scope, integrity: stored.integrity, bytes, extracted, entries };
			return established ? { ...result, reused: true, established } : { ...result, reused: true };
		}

		const abort = new AbortController();
		const timer = setTimeout(() => abort.abort(), this.#limits.timeout);
		const stage = await this.#store.put(record);

		try {
			const body = await this.#request(tarball, headers, abort.signal, `${name}@${version}`);
			const archive = new Archive(this.#limits, integrity, established);
			const outcome = await archive.extract(body, stage);

			const verified = established ? outcome.integrity : pinned.integrity;
			const source = await this.#store.commit(stage, { ...record, integrity: verified, ...outcome });
			const { bytes, extracted, entries } = source;
			const result = { node, key: record.key, scope, integrity: source.integrity, bytes, extracted, entries };
			return established ? { ...result, reused: false, established } : { ...result, reused: false };
		} catch (error) {
			// Stop the transfer at once: a refused archive is not read to its end
			abort.abort();
			await this.#store.discard(stage).catch((): void => {});
			throw error;
		} finally {
			clearTimeout(timer);
		}
	}

	async #request(url: string, headers: Record<string, string>, signal: AbortSignal, what: string) {
		const host = new URL(url).host;

		let response: Response;
		try {
			response = await fetch(url, { headers, signal });
		} catch {
			throw new Refusal('DOWNLOAD_FAILED', `The archive of "${what}" could not be requested to ${host}`);
		}

		const { status } = response;
		if (status === 401 || status === 403) {
			const code = status === 401 ? 'PROVIDER_AUTH_REQUIRED' : 'PROVIDER_AUTH_DENIED';
			throw new Refusal(code, `${host} refused the archive of "${what}" with status ${status}`);
		}
		if (status === 404) throw new Refusal('ARCHIVE_NOT_FOUND', `${host} does not have the archive of "${what}"`);
		if (!response.ok || !response.body) {
			throw new Refusal('DOWNLOAD_FAILED', `${host} answered the archive of "${what}" with status ${status}`);
		}

		// A declared length over the limit is refused before a byte is read
		const length = Number(response.headers.get('content-length'));
		if (length > this.#limits.compressed) {
			const message = `The archive of "${what}" declares ${length} bytes, over the limit of ${this.#limits.compressed}`;
			throw new Refusal('ARCHIVE_TOO_LARGE', message);
		}
		return Readable.fromWeb(<any>response.body);
	}
}
