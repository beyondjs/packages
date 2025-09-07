import type { Preprocessor } from '../preprocessor';
import type { Delegated } from '../preprocessor/item/delegates/delegated';
import { DynamicProcessor } from '@beyond-js/dynamic-processor/main';

export class Delegate extends DynamicProcessor(Map<string, Delegated>) {
	get dp() {
		return 'processor.delegator.delegate';
	}

	#name: string;
	get name() {
		return this.#name;
	}

	#preprocessor: Preprocessor;
	get preprocessor() {
		return this.#preprocessor;
	}

	constructor(name: string, preprocessor: Preprocessor) {
		super();
		this.#name = name;
		this.#preprocessor = preprocessor;

		super.setup(new Map([['preprocessor', { child: preprocessor }]]));
	}

	_process() {
		const preprocessor = this.#preprocessor;

		const updated = new Map();
		preprocessor.forEach((item, key) => {
			if (!item.delegates.has(this.#name)) return;
			const delegate = item.delegates.get(this.#name);
			updated.set(key, delegate);
		});

		const changed =
			this.size !== preprocessor.size ||
			![...updated.values()].every(([key, delegate]) => this.has(key) && delegate.hash === this.get(key).hash);
		if (!changed) return false;

		this.clear();
		updated.forEach((item, key) => this.set(key, item));
	}
}
