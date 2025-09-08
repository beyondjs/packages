import type { Preprocessor } from '../preprocessor';
import type { Delegated } from '../preprocessor/item/delegates/delegated';
import { DynamicProcessor } from '@beyond-js/dynamic-processor/main';

export class Delegator extends DynamicProcessor(Map<string, Delegated>) {
	get dp() {
		return 'processor.delegator.delegator';
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

		const updated: Map<string, Delegated> = new Map();
		preprocessor.forEach((item, key) => {
			if (!item.delegates.has(this.#name)) return;

			const delegated = item.delegates.get(this.#name);
			updated.set(key, delegated);
		});

		const changed =
			this.size !== preprocessor.size ||
			[...updated].every(([key, delegated]) => this.has(key) && delegated.hash === this.get(key).hash);
		if (!changed) return false;

		this.clear();
		updated.forEach((item, key) => this.set(key, item));
	}
}
