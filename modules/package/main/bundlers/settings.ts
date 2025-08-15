import { DynamicProcessor } from '@beyond-js/dynamic-processor/main';
import { equal } from '@beyond-js/equal/main';

export default class BunddlerSettings extends DynamicProcessor() {
	get dp() {
		return 'bundler.settings';
	}

	#values: Record<string, any>;
	get values() {
		return this.#values;
	}
	set values(values) {
		if (equal(values, this.#values)) return;

		this.#values = values;
		this._invalidate();
	}

	constructor(values: Record<string, any> = {}) {
		super();
		this.#values = values;
	}
}
