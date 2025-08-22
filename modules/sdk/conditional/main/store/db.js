const sqlite = require('sqlite3');
const fs = require('@beyond-js/fs');
const { promisify } = require('util');
const { PendingPromise } = require('@beyond-js/pending-promise/main');

module.exports = new (class {
	#db;

	#ready;
	get ready() {
		return this.#ready || this.initialise();
	}

	#run;
	#get;
	#exec;

	#error;
	get error() {
		return this.#error;
	}
	get valid() {
		return !this.#error;
	}

	constructor() {
		this.ready.catch(exc => console.error(exc.stack));
	}

	async run(...params) {
		await this.#ready;
		return await this.#run(...params);
	}

	async get(...params) {
		await this.#ready;
		return await this.#get(...params);
	}

	async initialise() {
		if (this.#ready) return await this.#ready;
		this.#ready = new PendingPromise();

		const name = 'bundlers.db';
		const dirname = require('path').join(process.cwd(), '.beyond/cache');
		const store = require('path').join(dirname, name);

		const exists = await fs.exists(store);
		!exists && (await fs.mkdir(dirname, { recursive: true }));

		this.#db = new sqlite.Database(store);
		this.#run = promisify(this.#db.run.bind(this.#db));
		this.#get = promisify(this.#db.get.bind(this.#db));
		this.#exec = promisify(this.#db.exec.bind(this.#db));

		if (exists) {
			this.#ready.resolve();
			return;
		}

		await this.#exec(`
			CREATE TABLE IF NOT EXISTS bundlers (
				bundler_id TEXT NOT NULL,
				data       TEXT NOT NULL
			);
			CREATE UNIQUE INDEX IF NOT EXISTS bundler_id_index
				ON bundlers (bundler_id);
			CREATE TABLE IF NOT EXISTS processor_outputs (
				bundler_id     TEXT NOT NULL,
				processor_name TEXT NOT NULL,
				type         TEXT NOT NULL,
				data           TEXT NOT NULL
			);
			CREATE UNIQUE INDEX IF NOT EXISTS processor_output_index
				ON processor_outputs (bundler_id, processor_name, type);
		`);

		this.#ready.resolve();
	}
})();
