import type { ProcessorSources } from '.';
import type { DynamicProcessorImplementation, RequireType } from '@beyond-js/dynamic-processor/main';
import { DynamicProcessor } from '@beyond-js/dynamic-processor/main';
import { createHash } from 'crypto';

export class ProcessorSourcesHash extends DynamicProcessor() {
	get dp() {
		return 'bundler.processor.sources.hash';
	}

	#sources: ProcessorSources;

	/**
	 * The calculated hash only considering the "inputs" of the processor
	 */
	#inputs: string;
	get inputs() {
		return this.#inputs;
	}

	/**
	 * The calculated hash only considering the "files" of the processor
	 */
	#files: string;
	get files() {
		return this.#files;
	}

	#delegated: string;
	get delegated() {
		return this.#delegated;
	}

	#value: string;
	get value() {
		return this.#value;
	}

	constructor(sources: ProcessorSources) {
		super();
		this.#sources = sources;

		const { inputs, files } = sources;
		const children: [string, { child: DynamicProcessorImplementation }][] = [];
		inputs && children.push(['inputs', { child: inputs }]);
		files && children.push(['files', { child: files }]);
		children.length && super.setup(new Map(children));
	}

	/**
	 * This method allows inheritance of the hash calculation
	 *
	 * @return {number} The calculated hash of the children of the inherited class
	 * @private
	 */
	_compute(): string {
		return;
	}

	_prepared(require: RequireType) {
		const { inputs, files } = this.#sources;
		inputs?.forEach((source, key) => require(source, key));
		files?.forEach((source, key) => require(source, key));
	}

	_process() {
		const { inputs, files } = this.#sources;

		function compute(hashes: string[]): string {
			const hash = createHash('sha256');
			hashes.sort().forEach(h => hash.update(h));
			return hash.digest('hex');
		}

		this.#inputs = inputs && compute([...inputs.values()].map(file => file.hash));
		this.#files = files && compute([...files.values()].map(file => file.hash));
		this.#delegated = this.#sources.delegated?.hash;

		const hashes = [this.#inputs, this.#files, this.#delegated, this._compute()].filter(Boolean);
		this.#value = compute(hashes);
	}
}
