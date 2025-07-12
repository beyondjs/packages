import { db } from './db.js';
import { ICollection } from '@beyond-js/packages/persistence/interfaces';

export class Collection<IItemData> implements ICollection<IItemData> {
	#name: string;

	constructor(name: string) {
		this.#name = name;
	}

	async get(params: { id: string }): Promise<IItemData | void> {
		const { id } = params;
		const sql = `SELECT data FROM ${this.#name} WHERE id = ?`;
		const result = await db.get(sql, [id]);
		return result ? JSON.parse(result.data) : undefined;
	}

	async set(params: { id: string; data: IItemData }): Promise<void> {
		const { id, data } = params;
		const sql = `INSERT OR REPLACE INTO ${this.#name} (id, data) VALUES (?, ?)`;
		await db.run(sql, [id, JSON.stringify(data)]);
	}

	async delete(params: { id: string }): Promise<void> {
		const { id } = params;
		const sql = `DELETE FROM ${this.#name} WHERE id = ?`;
		await db.run(sql, [id]);
	}
}
