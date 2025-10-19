import * as sqlite from 'sqlite3';
import { join } from 'path';
import { promisify } from 'util';
import { existsSync, mkdirSync } from 'fs';
import { PendingPromise } from '@beyond-js/pending-promise/main';

export abstract class DB {
	#db: sqlite.Database;

	_run: (sql: string, params?: any[]) => Promise<any>;
	_get: (sql: string, params?: any[]) => Promise<any>;
	_exec: (sql: string) => Promise<void>;

	#ready: PendingPromise<void>;
	get ready(): Promise<void> {
		return this.#ready;
	}

	constructor() {
		this.#ready = new PendingPromise<void>();
		this._prepare(this.#ready);
	}

	abstract _store(): Promise<{ path: string; file: string }>;

	async _prepare(ready: PendingPromise<void>) {
		const { path, file } = await this._store();

		if (!existsSync(path)) mkdirSync(path, { recursive: true });
		const store = join(path, file);
		this.#db = new sqlite.Database(store);

		this._run = promisify(this.#db.run.bind(this.#db));
		this._get = promisify(this.#db.get.bind(this.#db));
		this._exec = promisify(this.#db.exec.bind(this.#db));

		this._initialise(ready);
	}

	abstract _initialise(ready: PendingPromise<void>): Promise<void>;

	async run(sql: string, params?: any[]) {
		await this.#ready;
		return this._run(sql, params);
	}

	async get(sql: string, params?: any[]) {
		await this.#ready;
		return this._get(sql, params);
	}

	async exec(sql: string) {
		await this.#ready;
		return this._exec(sql);
	}
}
