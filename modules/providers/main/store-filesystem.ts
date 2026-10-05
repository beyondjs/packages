import type { IMetadataStore, IMetadataRecord } from '@beyond-js/packages/providers/types';
import { promises as fs } from 'fs';
import { createHash, randomBytes } from 'crypto';
import { isAbsolute, join, resolve } from 'path';

const PROTOCOL = 'beyond-metadata/1';
// A URL that carries user information (`https://user:secret@host/…`)
const USERINFO = /^https?:\/\/[^/?#]*@/i;

/**
 * Package metadata kept in a directory, durable between processes and shared by every workspace of a user:
 *
 *     <root>/<2 hex>/<62 hex>.json      { protocol, key, scope, document, cache }
 *
 * The name of a record is the SHA-256 of its key. A key is opaque and already carries the scope (`public`,
 * `org:<tenant>`, or a digest of a credential), the provider, the package and the release: it is never
 * reinterpreted, only hashed, and the record keeps the whole key so that a read verifies it. A record of one
 * scope is therefore never found through the key of another.
 *
 * A record is written to a temporary file of its directory and renamed over the previous one, which is atomic
 * within one filesystem: a reader finds a whole record or none, and two processes writing one key leave one
 * of them. A record that cannot be read (absent, truncated, of another key or protocol) is a miss, and the
 * metadata is requested again.
 *
 * It keeps what `Metadata` gives it and nothing else: the scope, the document and its cache validators
 * (`etag`, `lastModified`). Credentials never reach it, and the user information of any address in a
 * document is removed before it is written, as the graph removes it from archive addresses. Files are
 * readable by their owner only.
 *
 * It is a cache: a record that cannot be written is metadata requested again later, never a failure of whoever
 * asked. A failed write resolves, and the first one is kept in `failure` for whoever reports it.
 */
export /*bundle*/ class FilesystemMetadataStore implements IMetadataStore {
	#root: string;
	/**
	 * The absolute directory the records are kept in
	 */
	get root() {
		return this.#root;
	}

	#failure?: { code: string; message: string };
	/**
	 * Why the first write that failed could not be made, by the code of its cause; undefined while every write
	 * succeeded
	 */
	get failure() {
		return this.#failure;
	}

	/**
	 * @param root Absolute directory; created on the first write
	 */
	constructor(root: string) {
		if (typeof root !== 'string' || !isAbsolute(root)) {
			throw new Error('The metadata store root must be an absolute path');
		}
		this.#root = resolve(root);
	}

	#file(key: string): string {
		const digest = createHash('sha256').update(key).digest('hex');
		return join(this.#root, digest.slice(0, 2), `${digest.slice(2)}.json`);
	}

	/**
	 * The record of a key, or undefined when there is none that can be read
	 */
	async get(key: string): Promise<IMetadataRecord | undefined> {
		if (typeof key !== 'string' || !key) return;
		try {
			const data = JSON.parse(await fs.readFile(this.#file(key), 'utf8'));
			if (data?.protocol !== PROTOCOL || data.key !== key || typeof data.scope !== 'string') return;
			if (data.document === void 0) return;
			return data.cache
				? { scope: data.scope, document: data.document, cache: data.cache }
				: { scope: data.scope, document: data.document };
		} catch {
			return;
		}
	}

	/**
	 * Writes the record of a key atomically, replacing the previous one. It resolves even when the record cannot be
	 * written (see `failure`); only a missing key or scope, a programming error, rejects.
	 */
	async set(key: string, record: IMetadataRecord): Promise<void> {
		if (typeof key !== 'string' || !key) throw new Error('A metadata key is required');
		if (!record || typeof record.scope !== 'string') throw new Error('A metadata record requires its scope');

		const file = this.#file(key);
		const cache = FilesystemMetadataStore.#validators(record.cache);
		const data = {
			protocol: PROTOCOL,
			key,
			scope: record.scope,
			document: FilesystemMetadataStore.#scrub(record.document),
			cache
		};

		const directory = join(file, '..');
		const temporary = join(directory, `.${randomBytes(8).toString('hex')}.tmp`);
		try {
			await fs.mkdir(directory, { recursive: true, mode: 0o700 });
			await fs.writeFile(temporary, JSON.stringify(data), { mode: 0o600 });
			await fs.rename(temporary, file);
		} catch (error) {
			await fs.rm(temporary, { force: true }).catch((): void => void 0);
			const code = typeof error?.code === 'string' ? error.code : 'unknown error';
			this.#failure ??= { code, message: `The metadata cache ${this.#root} could not be written (${code})` };
		}
	}

	/**
	 * Only the validators a conditional request needs
	 */
	static #validators(cache: IMetadataRecord['cache']): IMetadataRecord['cache'] | undefined {
		if (!cache || typeof cache !== 'object') return;
		const { etag, lastModified } = cache;
		const kept = {
			...(typeof etag === 'string' ? { etag } : {}),
			...(typeof lastModified === 'string' ? { lastModified } : {})
		};
		return Object.keys(kept).length ? kept : void 0;
	}

	/**
	 * A copy of a document whose addresses carry no user information
	 */
	static #scrub(value: any): any {
		if (typeof value === 'string') {
			if (!USERINFO.test(value)) return value;
			try {
				const url = new URL(value);
				url.username = '';
				url.password = '';
				return url.href;
			} catch {
				return value;
			}
		}
		if (!value || typeof value !== 'object') return value;
		if (Array.isArray(value)) return value.map(item => FilesystemMetadataStore.#scrub(item));

		const copy: Record<string, any> = {};
		for (const key of Object.keys(value)) copy[key] = FilesystemMetadataStore.#scrub(value[key]);
		return copy;
	}
}
