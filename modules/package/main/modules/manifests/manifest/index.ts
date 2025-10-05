import type { ModuleManifestsFinder } from '../finder';
import type { IFinderItemCtor } from '@beyond-js/finder/collection';
import type { FileData } from '@beyond-js/file/data';
import { Config } from '@beyond-js/config/main';
import { ManifestModules } from './modules';

export class Manifest {
	#file: FileData;
	get file() {
		return this.#file;
	}

	#modules: ManifestModules;
	get modules() {
		return this.#modules;
	}

	#static: Config;
	get static() {
		return this.#static;
	}

	constructor(finder: ModuleManifestsFinder, file: FileData) {
		void finder;
		this.#file = file;

		const config = new Config(file.dirname, { '/static': 'object' });
		config.data = file.basename;

		this.#modules = new ManifestModules(this, config);
		this.#static = <Config>config.get('/static');
	}
}

const _assert: IFinderItemCtor = Manifest;
