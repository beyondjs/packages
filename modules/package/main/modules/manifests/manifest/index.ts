import type { FileData } from '@beyond-js/file/data';
import { Config } from '@beyond-js/config/main';
import { ManifestModules } from './modules';
import { createHash } from 'crypto';

export class Manifest {
	#file: FileData;
	get file() {
		return this.#file;
	}

	#id: string;
	get id() {
		return this.#id;
	}

	#modules: ManifestModules;
	get modules() {
		return this.#modules;
	}

	#static: Config;
	get static() {
		return this.#static;
	}

	constructor(file: FileData) {
		this.#file = file;
		this.#id = createHash('md5').update(`${file.file}`).digest('hex').toString();

		const config = new Config(file.dirname, { '/static': 'object' });
		config.data = file.basename;

		this.#modules = new ManifestModules(this, config);
		this.#static = <Config>config.get('/static');
	}
}
