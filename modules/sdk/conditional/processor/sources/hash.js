const DynamicProcessor = require('@beyond-js/dynamic-processor')();

module.exports = class extends DynamicProcessor {
	get dp() {
		return 'bundler.processor.sources.hash';
	}

	#sources;

	/**
	 * The calculated hash only considering the "inputs" of the processor
	 * @return {number}
	 */
	#inputs;
	get inputs() {
		return this.#inputs;
	}

	/**
	 * The calculated hash only considering the "files" of the processor
	 * @return {number}
	 */
	#files;
	get files() {
		return this.#files;
	}

	#extensions;
	get extensions() {
		return this.#extensions;
	}

	#value;
	get value() {
		return this.#value;
	}

	constructor(sources) {
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

	_prepared(require) {
		const { inputs, files } = this.#sources;
		inputs?.forEach(source => require(source));
		files?.forEach(source => require(source));
	}

	_process() {
		const { inputs, files } = this.#sources;

		let compute = 0;
		this.#inputs = inputs?.forEach(source => (compute += source.hash));
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
};
