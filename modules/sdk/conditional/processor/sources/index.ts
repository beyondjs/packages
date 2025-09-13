import type { ConditionalProcessor } from '../../processor';
import type { IProcessorSourcesStrategy } from '../types';
import type { DynamicProcessorImplementation, RequireType } from '@beyond-js/dynamic-processor/main';
import { DynamicProcessor } from '@beyond-js/dynamic-processor/main';
import { ProcessorInputs } from './inputs';
import { ProcessorFiles } from './files';
import { DelegationCollector } from './delegated';
import { createHash } from 'crypto';

export class ProcessorSources extends DynamicProcessor() {
	get dp() {
		return 'bundler.processor.sources';
	}

	#processor: ConditionalProcessor;
	get processor(): ConditionalProcessor {
		return this.#processor;
	}

	#inputs: ProcessorInputs;
	get inputs(): ProcessorInputs {
		return this.#inputs;
	}

	#files: ProcessorFiles;
	get files(): ProcessorFiles {
		return this.#files;
	}

	#delegated: DelegationCollector;
	get delegated(): DelegationCollector {
		return this.#delegated;
	}

	#hash: string;
	get hash(): string {
		return this.#hash;
	}

	#hashes: { inputs?: string; files?: string; delegated?: string } = {};
	get hashes() {
		return this.#hashes;
	}

	/**
	 * This method allows inheritance of the hash calculation
	 *
	 * @return {number} The calculated hash of the children of the inherited class
	 * @private
	 */
	_hash(): string {
		return;
	}

	constructor(processor: ConditionalProcessor, strategy: IProcessorSourcesStrategy) {
		super();
		this.#processor = processor;

		const children: [string, { child: DynamicProcessorImplementation }][] = [];

		const Inputs = strategy.inputs && (strategy.inputs.Inputs || ProcessorInputs);
		this.#inputs = Inputs && new Inputs(processor, strategy.inputs);
		Inputs && children.push(['inputs', { child: this.#inputs }]);

		const Files = strategy.files?.length && ProcessorFiles;
		this.#files = Files && new Files(processor, strategy.files);
		Files && children.push(['files', { child: this.#files }]);

		this.#delegated = new DelegationCollector(processor);
		children.push(['delegated', { child: this.#delegated }]);

		children.length && super.setup(new Map(children));
	}

	_prepared(require: RequireType) {
		this.#inputs?.forEach((source, key) => require(source, key));
		this.#files?.forEach((source, key) => require(source, key));
		this.#delegated && require(this.#delegated, 'delegated');
	}

	_process() {
		function compute(hashes: string[]): string {
			const hash = createHash('sha256');
			hashes.sort().forEach(h => hash.update(h));
			return hash.digest('hex');
		}

		const hashes = this.#hashes;
		hashes.inputs = this.#inputs && compute([...this.#inputs.values()].map(file => file.hash));
		hashes.files = this.#files && compute([...this.#files.values()].map(file => file.hash));
		hashes.delegated = this.#delegated?.hash;

		const all = [hashes.inputs, hashes.files, hashes.delegated, this._hash()].filter(Boolean);
		this.#hash = compute(all);
	}

	destroy() {
		this.#inputs.destroy();
		this.#files?.destroy();
		this.#delegated?.destroy();
	}
}
