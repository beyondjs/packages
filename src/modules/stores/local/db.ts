import sqlite from 'sqlite3';
import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { promisify } from 'util';
import { PendingPromise } from '@beyond-js/pending-promise/main';

export class LocalDB {
	#db: sqlite.Database;
	#ready: PendingPromise<void>;
	#run: (sql: string, params?: any[]) => Promise<any>;
	#get: (sql: string, params?: any[]) => Promise<any>;
	#exec: (sql: string) => Promise<void>;

	constructor() {
		this.#ready = this.#initialise();
	}

	get ready(): Promise<void> {
		return this.#ready;
	}

	async run(sql: string, params?: any[]) {
		await this.#ready;
		return this.#run(sql, params);
	}

	async get(sql: string, params?: any[]) {
		await this.#ready;
		return this.#get(sql, params);
	}

	async exec(sql: string) {
		await this.#ready;
		return this.#exec(sql);
	}

	async #initialise(): PendingPromise<void> {
		const promise = new PendingPromise<void>();

		const name = 'packages.db';
		const dir = join(process.cwd(), '.beyond/cache');
		const store = join(dir, name);

		if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

		this.#db = new sqlite.Database(store);
		this.#run = promisify(this.#db.run.bind(this.#db));
		this.#get = promisify(this.#db.get.bind(this.#db));
		this.#exec = promisify(this.#db.exec.bind(this.#db));

		await this.#exec(`
			CREATE TABLE IF NOT EXISTS packages (
				key TEXT PRIMARY KEY,
				data TEXT NOT NULL
			);
		`);

		promise.resolve();
		return promise;
	}
}

export const db = new LocalDB();
