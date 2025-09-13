import type { ConditionalProcessor } from '../..';
import type { IDiagnostic } from '@beyond-js/packages/types';
import type { Output } from '../../outputs/output';
import { DynamicProcessor } from '@beyond-js/dynamic-processor/main';
import { DelegatingProcessors } from './processors';
import { createHash } from 'crypto';

/**
 * The files collected from the extensions of the current processor
 */
export class DelegationCollector extends DynamicProcessor(Map<string, Output>) {
	get dp() {
		return 'processor.delegation-collector';
	}

	#processor: ConditionalProcessor;
	get processor(): ConditionalProcessor {
		return this.#processor;
	}

	#delegators: DelegatingProcessors;
	get delegators(): DelegatingProcessors {
		return this.#delegators;
	}

	#hash: string;
	get hash(): string {
		return this.#hash;
	}

	#errors: IDiagnostic[] = [];
	get errors(): IDiagnostic[] {
		return this.#errors;
	}

	get valid(): boolean {
		return !this.errors.length;
	}

	constructor(processor: ConditionalProcessor) {
		super();
		this.#processor = processor;

		// The extensions of the current processor being extended by other processors of the same bundle
		// The extensions hashes are used since these, in turn, have the extensions as children
		this.#delegators = new DelegatingProcessors(processor);
		super.setup(new Map([['delegators', { child: this.#delegators }]]));
	}

	_process() {
		if (!this.#delegators.valid) {
			this.clear();
			this.#errors = this.#delegators.errors;

			// If hash is set, return true to indicate a change
			const changed = !!this.#hash;
			this.#hash = void 0;
			return changed;
		}

		// Calculate the hash of the delegators collected outputs
		const hashes: string[] = [];
		this.#delegators.forEach(outputs => {
			outputs.forEach(output => hashes.push(output.source.hash));
		});
		const md5 = createHash('md5');
		hashes.sort().forEach(hash => md5.update(hash));
		const hash = md5.digest('hex');

		// If the hash is the same as the previous one, return false to indicate no changes
		if (this.#hash === hash) return false;

		this.clear();
		this.#delegators.forEach(outputs => {
			outputs.forEach(output => this.set(output.source.relative.file, output));
		});
	}
}
