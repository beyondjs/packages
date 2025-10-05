import type { IBeyondPackageManifest } from '@beyond-js/packages/types';
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
export class ModuleManifestsFinder extends FinderCollection<typeof Manifest> {
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
		super({ Item: Manifest, watcher });
		this.#config = config;
	}

	_prepared(require: RequireType) {
		super._prepared(require);

		this.#errors = [];

		if (!require(this.#config, 'package-config')) return false;

		const config = <IBeyondPackageManifest>this.#config.value;
		const modules = config.beyond?.modules;

		if (!this.#config.valid || !modules) {
			this.configure();
			return;
		}

		const path = (() => {
			if (typeof modules === 'string') {
				// config.path is the path of the package.json file
				// When modules is a string, it is relative to the package.json file
				return join(this.#config.path, modules);
			} else if (typeof modules === 'object' && modules.path) {
				// modules is an object with a path property
				// The path is relative to the package.json file
				return join(this.#config.path, modules.path);
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
