import type { RequireType } from '@beyond-js/dynamic-processor/main';
import { DynamicProcessor } from '@beyond-js/dynamic-processor/main';
import { Config } from '@beyond-js/config/main';
import { ModuleExports } from './exports';

export class Modules extends DynamicProcessor(Map) {
	get dp() {
		return 'package.modules';
	}

	#exports: ModuleExports;

	constructor(config: Config) {
		super();
		this.#exports = new ModuleExports(config);
	}

	_prepared(require: RequireType): void {
		require(this.#exports, 'module-exports');
	}

	_process() {
		const exports = this.#exports;
		console.log('Module exports:', exports.valid, [...this.#exports.values()]);
	}
}
