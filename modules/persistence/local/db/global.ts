import { DB } from './db';
import { PendingPromise } from '@beyond-js/pending-promise/main';
import { join } from 'path';

export class GlobalDB extends DB {
	async _store() {
		const envpaths = (await import('env-paths')).default;
		const paths = envpaths('beyondjs');
		const path = join(paths.cache, '.beyond/cache');
		const file = 'packages.db';

		return { path, file };
	}

	async _initialise(ready: PendingPromise<void>): Promise<void> {
		const collections = ['Packages', 'PackageReleases'];

		let sql = '';
		collections.forEach(collection => {
			sql += `CREATE TABLE IF NOT EXISTS ${collection} (id TEXT PRIMARY KEY, data TEXT NOT NULL);\n`;
		});

		this._exec(sql)
			.then(() => ready.resolve())
			.catch(exc => ready.reject(exc));
	}
}
