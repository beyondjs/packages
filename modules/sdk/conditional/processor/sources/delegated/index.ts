import type { Processor } from '../..';
import type { IDiagnostic } from '@beyond-js/packages/types';
import type { RequireType } from '@beyond-js/dynamic-processor/main';
import type { Delegated } from '../../delegator/preprocessor/item/delegates/delegated';
import { DynamicProcessor } from '@beyond-js/dynamic-processor/main';
import { DelegatingProcessors } from './processors';
import { equal } from '@beyond-js/equal/main';
import { createHash } from 'crypto';

/**
 * The files collected from the extensions of the current processor
 */
export class DelegationCollector extends DynamicProcessor(Map<string, Delegated>) {
	get dp() {
		return 'processor.delegation-collector';
	}

	#processor: Processor;
	get processor(): Processor {
		return this.#processor;
	}

	#delegators: DelegatingProcessors;
	get delegators(): DelegatingProcessors {
		return this.#delegators;
	}

	#hash?: string;
	get hash(): string {
		if (this.#hash) return this.#hash;

		const hashes = [...this.values()].map(delegated => delegated.hash);
		const hash = createHash('sha256');
		hashes.sort().forEach(h => hash.update(h));
		return (this.#hash = hash.digest('hex'));
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

		// The extensions of the current processor being extended by other processors of the same bundle
		// The extensions hashes are used since these, in turn, have the extensions as children
		this.#delegators = new DelegatingProcessors(processor);
		super.setup(new Map([['delegators', { child: this.#delegators }]]));
	}

	_prepared(require: RequireType) {
		this.#delegators.forEach(delegator => require(delegator, delegator.name));
	}

	_process() {
		this.clear();
		this.#hash = void 0;

		const errors: IDiagnostic[] = (this.#errors = []);
		this.#delegators.forEach(delegator => {
			const { preprocessor } = delegator;
			if (!preprocessor.valid) {
				const code = 'PROCESSOR_PREPROCESSOR_ERROR';
				const message = `Processor "${delegator.name}" has been preprocessed with errors`;
				errors.push({ code, message });
			}

			delegator.forEach(delegated => this.set(delegated.file.relative.file, delegated));
		});
	}
}
