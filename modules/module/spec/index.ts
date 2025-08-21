import type { ExportsTargetType, IManifestModuleSpec } from '@beyond-js/packages/types';
import { DynamicProcessor } from '@beyond-js/dynamic-processor/main';
import { equal } from '@beyond-js/equal/main';

export /*bundle*/ type ModuleSpecType = ExportsTargetType | IManifestModuleSpec;

export /*bundle*/ class ModuleSpec extends DynamicProcessor() {
	get dp() {
		return 'module-manifest.module-spec';
	}

	#id: string;
	get id() {
		return this.#id;
	}

	#bundler: string;
	get bundler() {
		return this.#bundler;
	}

	#values: ModuleSpecType;
	get values() {
		return this.#values;
	}

	constructor(id: string, bundler: string) {
		super();
		this.#id = id;
		this.#bundler = bundler;
	}

	update(values: ModuleSpecType) {
		values = values || {};

		const changed = !equal(values, this.#values);
		if (!changed) return;

		this.#values = values;
		this._invalidate();
	}
}
