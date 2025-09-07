import type { Processor } from '../..';
import type { IDiagnostic } from '@beyond-js/packages/types';
import type { RequireType } from '@beyond-js/dynamic-processor/main';
import { DynamicProcessor } from '@beyond-js/dynamic-processor/main';
import { DelegatorsHashes } from './hashes';

/**
 * The files collected from the extensions of the current processor
 */
export class ProcessorDelegators extends DynamicProcessor(Map) {
	get dp() {
		return 'processor.sources.delegators';
	}

	#processor: Processor;
	get processor(): Processor {
		return this.#processor;
	}

	#hashes: DelegatorsHashes;
	get hashes(): DelegatorsHashes {
		return this.#hashes;
	}

	#errors: IDiagnostic[] = [];
	get errors(): IDiagnostic[] {
		return this.#errors;
	}

	get valid(): boolean {
		return !this.errors.length;
	}

	constructor(processor: Processor) {
		super();
		this.#processor = processor;
		this.#hashes = new (require('./hashes'))(this);

		// The extensions of the current processor being extended by other processors of the same bundle
		// The extensions hashes are used since these, in turn, have the extensions as children
		super.setup(new Map([['extensions.hashes', { child: this.#hashes }]]));
	}

	_prepared(require: RequireType) {
		this.#hashes.forEach(exthash => require(exthash));
	}

	_process() {
		this.clear();

		const errors: IDiagnostic[] = (this.#errors = []);
		this.#hashes.forEach(exthash => {
			const { extension } = exthash;
			if (!extension.valid) {
				const code = 'EXTENSION_ERROR';
				const message = `Extension "${extension.processor.name}" has been preprocessed with errors`;
				errors.push({ code, message });
			}

			extension.files.forEach(source => this.set(source.relative.file, source));
		});
	}
}
