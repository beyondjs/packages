import type { IMetadataStore, IMetadataRecord } from '@beyond-js/packages/providers/types';
import { db } from '@beyond-js/packages/persistence/db';

/**
 * Keeps package metadata in the local database. Keys arrive complete (scope, provider, package and
 * release): they are only encoded to be valid identifiers. Without an initialised database the store
 * holds nothing, and metadata is simply requested again.
 */
export class DatabaseMetadataStore implements IMetadataStore {
	#collection(key: string) {
		try {
			return key.includes('|manifest|') ? db.releases : db.packages;
		} catch {
			return;
		}
	}

	async get(key: string): Promise<IMetadataRecord | undefined> {
		const collection = this.#collection(key);
		if (!collection) return;

		const stored: any = await collection.get({ id: encodeURIComponent(key) });
		if (!stored || !stored.document || typeof stored.scope !== 'string') return;
		return { scope: stored.scope, document: stored.document, cache: stored.cache };
	}

	async set(key: string, record: IMetadataRecord): Promise<void> {
		const collection = this.#collection(key);
		if (!collection) return;

		const id = encodeURIComponent(key);
		const data: any = { id, public: record.scope === 'public', ...record };
		await collection.set({ id, data });
	}
}
