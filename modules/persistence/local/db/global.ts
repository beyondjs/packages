import envpaths from 'env-paths';
import { DB } from './db';
import { PendingPromise } from '@beyond-js/pending-promise/main';
import { join } from 'path';

export class GlobalDB extends DB {
	constructor() {
		const paths = envpaths('beyondjs');
		const path = join(paths.cache, '.beyond/cache');
		const name = 'packages.db';

		console.log('Global cache database path', path, name);
		super(path, name);
	}

	async _initialise(ready: PendingPromise<void>): Promise<void> {
		const collections = ['packages'];

		let sql = '';
		collections.forEach(collection => {
			sql += `CREATE TABLE IF NOT EXISTS ${collection} (id TEXT PRIMARY KEY, data TEXT NOT NULL);\n`;
		});

		this._exec(sql)
			.then(() => ready.resolve())
			.catch(exc => ready.reject(exc));
	}
}
