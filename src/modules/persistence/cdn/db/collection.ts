import { Collection as CollectionBase } from '@beyond-js/firestore-collection/collection';
import type { ICollection } from '@beyond-js/packages/persistence/interfaces';

export /*bundle*/ class Collection<DATA> implements ICollection<DATA> {
	#collection: CollectionBase<DATA>;

	constructor(name: string) {
		this.#collection = new CollectionBase<DATA>(name);
	}

	async get(params: { id: string }): Promise<DATA | void> {
		const { id } = params;
		const response = await this.#collection.data({ id });
		if (!response.data.exists) return;

		return response.data.data;
	}

	async set(params: { id: string; data: DATA }): Promise<void> {
		const { id, data } = params;
		await this.#collection.set({ id, data });
	}

	async delete(params: { id: string }): Promise<void> {
		const { id } = params;
		await this.#collection.delete({ id });
	}
}
