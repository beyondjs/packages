import type { ExportsEntry } from '@beyond-js/packages/sdk/types';
import type { IManifestModuleSpec } from '@beyond-js/packages/types';
import { DynamicProcessor } from '@beyond-js/dynamic-processor/main';
import { equal } from '@beyond-js/equal/main';

export class ModuleSpec extends DynamicProcessor() {
	get dp() {
		return 'module-manifest.module-spec';
	}

	#id: string;
	get id() {
		return this.#id;
	}

	#value: ExportsEntry | IManifestModuleSpec;
	get value() {
		return this.#value;
	}

	constructor(id: string) {
		super();
		this.#id = id;
	}

	update(value: string | Record<string, any>) {
		value = value || {};

		const changed = !equal(value, this.#value);
		if (!changed) return;

		this.#value = value;
		this._invalidate();
	}
}
