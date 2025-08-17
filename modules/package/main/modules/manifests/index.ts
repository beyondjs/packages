import type { Config } from '@beyond-js/config/main';
import type { RequireType } from '@beyond-js/dynamic-processor/main';
import { DynamicProcessor } from '@beyond-js/dynamic-processor/main';
import { ModuleManifestsFinder } from './finder';

export class ModuleManifests extends DynamicProcessor(Map<string, any>) {
	get dp() {
		return 'package.module.manifests';
	}

	#finder: ModuleManifestsFinder;

	constructor(config: Config) {
		super();
		this.#finder = new ModuleManifestsFinder(config);
	}

	_prepared(require: RequireType): void {
		require(this.#finder, 'package.module-manifests.finder');
	}

	_process() {
		this.#finder.forEach(manifest => this.set(manifest.id, manifest));
	}
}
