import type { Processor } from '../..';
import type { IDiagnostic } from '@beyond-js/packages/types';
import type { RequireType } from '@beyond-js/dynamic-processor/main';
import { DynamicProcessor } from '@beyond-js/dynamic-processor/main';
import { ProcessorsExtensionsHashes } from './processors';

/**
 * The files collected from the extensions of the current processor
 */
export class ProcessorExtensions extends DynamicProcessor(Map) {
	get dp() {
		return 'processor.sources.extensions';
	}

	#processor: Processor;
	get processor(): Processor {
		return this.#processor;
	}

	#hashes: ProcessorsExtensionsHashes;
	get hashes(): ProcessorsExtensionsHashes {
		return this.#hashes;
	}

	#errors: IDiagnostic[] = [];
	get errors(): IDiagnostic[] {
		return this.#errors;
	}

	get valid() {
		return !this.errors.length;
	}

	#template;

	constructor(processor: Processor) {
		super();
		this.#processor = processor;
		this.#hashes = new (require('./hashes'))(this);

		const { bundle } = processor.spec;
		this.#template = bundle.type.startsWith('template/');
		if (this.#template) return;

		// The extensions of the current processor being extended by other processors of the same bundle
		// The extensions hashes are used since these, in turn, have the extensions as children
		const hashes = new ProcessorsExtensionsHashes(processor);
		super.setup(new Map([['extensions.hashes', { child: hashes }]]));
	}

	_prepared(require: RequireType) {
		if (this.#template) return;
		const exthashes = this.children.get('extensions.hashes').child;
		exthashes.forEach(exthash => require(exthash));
	}

	_process() {
		if (this.#template) return;
		const exthashes = this.children.get('extensions.hashes').child;
		this.clear();

		const errors = (this.#errors = []);
		exthashes.forEach(exthash => {
			const { extension } = exthash;
			extension.valid
				? extension.files.forEach(source => this.set(source.relative.file, source))
				: errors.push(`Extension "${extension.processor.name}" has been preprocessed with errors`);
		});
	}
}
