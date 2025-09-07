import type { ProcessorSources } from '.';
import type { RequireType } from '@beyond-js/dynamic-processor/main';
import { DynamicProcessor } from '@beyond-js/dynamic-processor/main';

export class ProcessorSourcesHash extends DynamicProcessor() {
	get dp() {
		return 'bundler.processor.sources.hash';
	}

	#sources: ProcessorSources;

	/**
	 * The calculated hash only considering the "inputs" of the processor
	 * @return {number}
	 */
	#inputs: number;
	get inputs() {
		return this.#inputs;
	}

	/**
	 * The calculated hash only considering the "files" of the processor
	 * @return {number}
	 */
	#files: number;
	get files() {
		return this.#files;
	}

	#extensions: number;
	get extensions() {
		return this.#extensions;
	}

	#value: string;
	get value() {
		return this.#value;
	}

	constructor(sources: ProcessorSources) {
		super();
		this.#sources = sources;

		const { inputs, files } = sources;
		const children = [];
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
	_compute() {
		return 0;
	}

	_prepared(require: RequireType) {
		const { inputs, files } = this.#sources;
		inputs?.forEach((source, key) => require(source, key));
		files?.forEach((source, key) => require(source, key));
	}

	_process() {
		const { inputs, files } = this.#sources;

		let compute = 0;
		// @TODO use reduce function
		this.#inputs = inputs?.reduce(source => (compute += source.hash), 0);
		this.#files = files?.forEach(source => (compute += source.hash));
		compute += this._compute();

		/**
		 * This hash calculation mechanism is mathematically imperfect, but in practical terms
		 * enough, .. if a hash duplicate occurs, it would only be required to make a change in any of
		 * the sources of the processor
		 */
		const value = this.#inputs + this.#files + this._compute();
		const changed = this.#value !== value;
		this.#value = value;
		return changed;

		const sh = this.children.get('sources.hash').child;
		this.#extensions = new Map(sh.extensions);
	}
}
