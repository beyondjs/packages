import { IModuleSpec, IModuleBundlerSpec } from '@beyond-js/packages/types';
import { DynamicProcessor } from '@beyond-js/dynamic-processor/main';
import { equal } from '@beyond-js/equal/main';

export default class BundlerSpec extends DynamicProcessor() implements IModuleBundlerSpec {
	get dp() {
		return 'module.specs';
	}

	#values: Record<string, any> = {};
	get values() {
		return this.#values;
	}
	set values(values) {
		values = values || {};

		const changed = !equal(values, this.#values);
		if (!changed) return;

		this.#values = values;
		this._invalidate();
	}

	get id() {
		return this.#values.id;
	}

	get subpath() {
		return this.#values.subpath;
	}

	get description() {
		return this.#values.description;
	}
}
