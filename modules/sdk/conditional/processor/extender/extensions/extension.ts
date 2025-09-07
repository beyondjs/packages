import type { Preprocessor } from '../preprocessor';
import { DynamicProcessor } from '@beyond-js/dynamic-processor/main';

export class Extension extends DynamicProcessor(Map) {
	get dp() {
		return 'processor.extender.extension';
	}

	#extending: string;
	get extending() {
		return this.#extending;
	}

	#preprocessor: Preprocessor;
	get preprocessor() {
		return this.#preprocessor;
	}

	constructor(extending: string, preprocessor: Preprocessor) {
		super();
		this.#extending = extending;
		this.#preprocessor = preprocessor;

		super.setup(new Map([['preprocessor', { child: preprocessor }]]));
	}

	_process() {
		const preprocessor = this.#preprocessor;

		const updated = new Map();
		preprocessor.forEach((item, key) => {
			if (!item.extensions.has(this.#extending)) return;
			const extension = item.extensions.get(this.#extending);
			updated.set(key, extension);
		});

		const changed =
			this.size !== preprocessor.size ||
			![...updated.values()].every(([key, extension]) => this.has(key) && extension.hash === this.get(key).hash);
		if (!changed) return false;

		this.clear();
		updated.forEach((item, key) => this.set(key, item));
	}
}
