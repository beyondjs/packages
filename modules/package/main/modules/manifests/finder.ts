import type { Config } from '@beyond-js/config/main';
import type { WatcherClient } from '@beyond-js/watchers/client';
import type { RequireType } from '@beyond-js/dynamic-processor/main';
import type { IDiagnostic } from '@beyond-js/finder/types';
import { FinderCollection } from '@beyond-js/finder/collection';
import { Manifest } from './manifest';
import { join } from 'path';

/**
 * Collection of modules of the package
 */
export class ModuleManifestsFinder extends FinderCollection<Manifest> {
	get dp() {
		return 'package.module-manifests.finder';
	}

	#config: Config;

	#errors: IDiagnostic[] = [];
	get errors() {
		return this.#errors;
	}

	get valid() {
		return !this.#errors.length;
	}

	constructor(config: Config, watcher?: WatcherClient) {
		console.log('Change the order of the parameters in the constructor of ModuleManifestsFinder');
		super(watcher, Manifest);
		this.#config = config;
	}

	_prepared(require: RequireType) {
		super._prepared(require);

		this.#errors = [];

		const config = this.#config;
		if (!require(config, 'package-config')) return false;

		if (!config.valid || !config.value?.modules) {
			this.configure();
			return;
		}

		const path = (() => {
			if (typeof config.value.modules === 'string') {
				// config.path is the path of the package.json file
				// When config.value.modules is a string, it is relative to the package.json file
				return join(config.path, config.value.modules);
			} else if (typeof config.value.modules === 'object' && config.value.modules.path) {
				// config.value.modules is an object with a path property
				// The path is relative to the package.json file
				return join(config.path, config.value.modules.path);
			} else {
				const code = 'INVALID_TYPE';
				const message =
					'Invalid type for "modules" in package.json. ' +
					'Expected a string or an object with a "path" property.';
				this.#errors = [{ code, message }];
				return;
			}
		})();
		if (!path) {
			super.configure();
			return;
		}

		this.configure(path, { filename: 'module.json', excludes: ['./builds', 'node_modules'] });
	}
}
