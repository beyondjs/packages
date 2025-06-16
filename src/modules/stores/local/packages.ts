import { LocalDB } from './db.js';

export class PackagesStore {
	#db: LocalDB;

	constructor(db: LocalDB) {
		this.#db = db;
	}

	async get(key: string): Promise<any | undefined> {
		try {
			const row = await this.#db.get('SELECT data FROM packages WHERE key=?', [key]);
			return row ? JSON.parse(row.data) : undefined;
		} catch (error) {
			console.error(`Error retrieving package '${key}':`, error);
			return;
		}
	}

	async set(key: string, value: any): Promise<void> {
		try {
			const data = JSON.stringify(value);
			await this.#db.run('INSERT OR REPLACE INTO packages (key, data) VALUES (?, ?)', [key, data]);
		} catch (error) {
			console.error(`Error saving package '${key}':`, error);
		}
	}

	async delete(key: string): Promise<void> {
		try {
			await this.#db.run('DELETE FROM packages WHERE key=?', [key]);
		} catch (error) {
			console.error(`Error deleting package '${key}':`, error);
		}
	}
}
