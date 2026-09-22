import type { ModuleManifestsFinder } from '../finder';
import type { IFinderItemCtor } from '@beyond-js/finder/collection';
import type { FileData } from '@beyond-js/file/data';
import { Config } from '@beyond-js/config/main';
import { ManifestModules } from './modules';
import { relative, sep } from 'path';

export class Manifest {
	#finder: ModuleManifestsFinder;

	#file: FileData;
	get file() {
		return this.#file;
	}

	/**
	 * The directory of the module relative to the package, empty for a module at the package root.
	 *
	 * The file is found from the root of the module sources, which a package may place in a subdirectory
	 * (`beyond.modules`), so its relative name alone does not locate the module from the package: the
	 * bundlers read the sources from the package directory, and an earlier version lost that subdirectory.
	 */
	get path(): string {
		return relative(this.#finder.root, this.#file.dirname).split(sep).join('/');
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
		this.#finder = finder;
		this.#file = file;

		const config = new Config(file.dirname, { '/static': 'object' });

		// The name of the document, with its extension: `basename` is the name without it, which the
		// published File utility only answered as the whole name while its extension had not been read
		config.data = file.filename;

		this.#modules = new ManifestModules(this, config);
		this.#static = <Config>config.get('/static');
	}
}

const _assert: IFinderItemCtor = Manifest;
