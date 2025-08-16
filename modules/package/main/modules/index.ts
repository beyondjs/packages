import type { RequireType } from '@beyond-js/dynamic-processor/main';
import { DynamicProcessor } from '@beyond-js/dynamic-processor/main';
import { Config } from '@beyond-js/config/main';
import { ModuleExports } from './exports';
import { ModuleManifests } from './manifests';

export class Modules extends DynamicProcessor(Map) {
	get dp() {
		return 'package.modules';
	}

	#exports: ModuleExports;
	#manifests: ModuleManifests;

	constructor(config: Config) {
		super();
		this.#exports = new ModuleExports(config);
		this.#manifests = new ModuleManifests(config);
	}

	_prepared(require: RequireType): void {
		require(this.#exports, 'module-exports');
	}

	_process() {
		const exports = this.#exports;
		console.log('Module exports:', exports.valid, [...this.#exports.values()]);

		// Validate subpath
		// const validate = /^\.\/[a-zA-Z0-9-_./]*$/;
		// if (!subpath || (subpath !== '.' && !subpath.startsWith('./')) || !validate.test(subpath)) {
		// 	const code = 'INVALID_SUBPATH';
		// 	const message =
		// 		`Invalid subpath: "${subpath}". ` +
		// 		`Subpath must be a non-empty string starting with './' and contain only valid characters.`;
		// 	return done({ errors: [{ code, message }] });
		// }
	}
}
