import type { IDiagnostic } from '@beyond-js/packages/types';
import type { Processor } from '../..';
import type { RequireType, IRequest } from '@beyond-js/dynamic-processor/main';
import { DynamicProcessor } from '@beyond-js/dynamic-processor/main';
import { PreprocessorItem } from './item';

export abstract class Preprocessor extends DynamicProcessor(Map<string, PreprocessorItem>) {
	get dp() {
		return 'processor.delegator.preprocessor';
	}

	#processor: Processor;
	get processor(): Processor {
		return this.#processor;
	}

	#delegates: string[];
	get delegates() {
		return this.#delegates;
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

	constructor(processor: Processor, delegates: string[]) {
		super();
		this.#processor = processor;
		this.#delegates = delegates;

		super.setup(new Map([['inputs', { child: processor.sources.inputs }]]));
	}

	_prepared(require: RequireType) {
		this.#processor.sources.inputs.forEach(file => require(file, file.relative.file));
	}

	abstract _preprocess(input: PreprocessorItem): Promise<void>;

	async _process(request: IRequest) {
		const { sources } = this.processor;
		const updated = new Map();

		for (const file of sources.inputs.values()) {
			let item = this.has(file.relative.file) && this.get(file.relative.file);
			if (item?.hash === file.hash) {
				updated.set(file.relative.file, item);
				continue;
			}

			item = new PreprocessorItem(file, this.#delegates);
			updated.set(file.relative.file, item);

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

	hydrate(cached: { errors: IDiagnostic[]; warnings: IDiagnostic[] }) {
		this.#errors = cached.errors ? cached.errors : [];
		this.#warnings = cached.warnings ? cached.warnings : [];
	}
}
