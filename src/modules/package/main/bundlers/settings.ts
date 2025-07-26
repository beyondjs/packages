import { DynamicProcessor } from '@beyond-js/dynamic-processor/main';
import { equal } from '@beyond-js/equal/main';

export default class BunddlerSettings extends DynamicProcessor() {
	get dp() {
		return 'bundler.settings';
	}

	#values;
	get values() {
		return this.#values;
	}
	set values(values) {
		if (equal(values, this.#values)) return;

		this.#values = values;
		this._invalidate();
	}

	constructor(values) {
		super();
		this.#values = values;
	}
}
