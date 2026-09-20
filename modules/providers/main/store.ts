import type { IMetadataStore, IMetadataRecord } from '@beyond-js/packages/providers/types';

/**
 * Metadata storage that lives in memory. It is the default of `Metadata`, and what tests share between
 * tenants to check that records do not cross scopes.
 */
export /*bundle*/ class MemoryMetadataStore implements IMetadataStore {
	#records: Map<string, IMetadataRecord> = new Map();

	get keys(): string[] {
		return [...this.#records.keys()];
	}

	async get(key: string) {
		return this.#records.get(key);
	}

	async set(key: string, record: IMetadataRecord) {
		this.#records.set(key, record);
	}
}
