import type { IDiagnostic } from '@beyond-js/packages/types';
import type { Processor } from '../..';
import type { ExtenderExtensions } from '../extensions';
import type { RequireType, IRequest } from '@beyond-js/dynamic-processor/main';
import { DynamicProcessor } from '@beyond-js/dynamic-processor/main';
import { PreprocessorItem } from './item';

export abstract class Preprocessor extends DynamicProcessor(Map<string, PreprocessorItem>) {
	get dp() {
		return 'processor.extender.preprocessor';
	}

	#extensions: ExtenderExtensions;
	get extensions(): ExtenderExtensions {
		return this.#extensions;
	}

	#errors: IDiagnostic[] = [];
	get errors(): IDiagnostic[] {
		return this.#errors;
	}

	#warnings: IDiagnostic[] = [];
	get warnings(): IDiagnostic[] {
		return this.#warnings;
	}

	get valid() {
		return !this.#errors?.length;
	}

	#processor: Processor;
	get processor(): Processor {
		return this.#processor;
	}

	constructor(processor: Processor, extensions: ExtenderExtensions) {
		super();
		this.#processor = processor;
		this.#extensions = extensions;

		super.setup(new Map([['inputs', { child: processor.sources.inputs }]]));
	}

	_prepared(require: RequireType) {
		this.#processor.sources.inputs.forEach(source => require(source));
	}

	abstract _preprocess(input: PreprocessorItem): Promise<void>;

	async _process(request: IRequest) {
		const { sources } = this.processor;
		const updated = new Map();

		for (const input of sources.inputs.values()) {
			let item = this.has(input.relative.input) && this.get(input.relative.input);
			if (item?.hash === input.hash) {
				updated.set(input.relative.input, item);
				continue;
			}

			item = new PreprocessorItem(input, this.#extensions);
			updated.set(input.relative.file, item);

			await this._preprocess(item);
			if (this._request !== request) return;
		}

		const changed =
			this.size !== updated.size ||
			![...this.keys()].every(key => updated.has(key) && updated.get(key).hash === this.get(key).hash);

		this.clear();
		updated.forEach((value, key) => this.set(key, value));
		return changed;
	}

	serialize() {
		return {
			errors: this.#errors,
			warnings: this.#warnings
		};
	}

	hydrate(cached) {
		this.#errors = cached.errors ? cached.errors : [];
		this.#warnings = cached.warnings ? cached.warnings : [];
	}
}
