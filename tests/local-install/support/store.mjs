/**
 * What a source store holds, read through the record the filesystem store publishes beside each verified source
 * (`source.json`, written into the stage before its atomic rename): a source counts only once its record exists.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Snapshot } from './layout.mjs';

export class Store {
	#directory;

	/**
	 * @param {string} directory The root of a filesystem source store
	 */
	constructor(directory) {
		this.#directory = directory;
	}

	/**
	 * The published records, optionally only those of one release; staged sources are not published
	 */
	sources(name, version) {
		return new Snapshot(this.#directory)
			.named('source.json')
			.filter(path => !path.startsWith('.staging/'))
			.map(path => JSON.parse(readFileSync(join(this.#directory, path), 'utf8')))
			.filter(source => (!name || source.name === name) && (!version || source.version === version));
	}
}
