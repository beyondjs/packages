import type { ConditionalProcessor } from '../..';
import type { IDiagnostic } from '@beyond-js/packages/types';
import type { ProcessorOutput } from '../../outputs/output';
import { DynamicProcessor } from '@beyond-js/dynamic-processor/main';
import { DelegatingProcessors } from './processors';
import { createHash } from 'crypto';

/**
 * The outputs that other processors of the same conditional delegate to this one, keyed by the relative
 * file they were produced for.
 *
 * The hash of the collection is the hash of the delegated sources, so the sources of the receiving
 * processor change, and it reprocesses, exactly when a delegator produced something different. A
 * delegator with errors empties the collection and publishes those errors, which the receiver reports
 * instead of building on inputs that are not there.
 */
export class DelegationCollector extends DynamicProcessor(Map<string, ProcessorOutput>) {
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

		// The processors that extend this one: their delegated outputs are the inputs collected here
		this.#delegators = new DelegatingProcessors(processor);
		super.setup(new Map([['delegators', { child: this.#delegators }]]));
	}

	_process() {
		if (!this.#delegators.valid) {
			this.clear();
			this.#errors = this.#delegators.errors;

			// A hash that was set means that outputs were collected before: that is a change
			const changed = !!this.#hash || !this.#errors.length;
			this.#hash = void 0;
			return changed;
		}

		// The hash of the collected outputs: the sources of the delegators and the code they produced
		const hashes: string[] = [];
		this.#delegators.forEach(outputs => {
			outputs.forEach(output => hashes.push(`${output.source.relative.file}:${output.source.hash}:${output.code.hash ?? ''}`));
		});
		const md5 = createHash('md5');
		hashes.sort().forEach(hash => md5.update(hash));
		const hash = md5.digest('hex');

		const changed = this.#hash !== hash || !!this.#errors.length;
		this.#errors = [];
		if (!changed) return false;

		this.#hash = hash;
		this.clear();
		this.#delegators.forEach(outputs => {
			outputs.forEach(output => this.set(output.source.relative.file, output));
		});
	}

	destroy() {
		super.destroy();
		this.#delegators.destroy();
		this.clear();
	}
}
