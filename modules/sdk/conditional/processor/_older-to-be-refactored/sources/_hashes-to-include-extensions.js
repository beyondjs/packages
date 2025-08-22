const DynamicProcessor = require('@beyond-js/dynamic-processor')();
const equal = require('@beyond-js/equal');
const crc32 = require('@beyond-js/crc32');

module.exports = class extends DynamicProcessor {
	get dp() {
		return 'processor.sources.hash';
	}

	#processor;
	get processor() {
		return this.#processor;
	}

	/**
	 * The hash of the extensions
	 * @type {Map<string, number>}
	 */
	#extensions = new Map();
	get extensions() {
		return this.#extensions;
	}

	/**
	 * The hash of the sources of the processor
	 * @return {number}
	 */
	get sources() {
		return this.children.get('sources.hash').child.sources;
	}

	/**
	 * The hash of all the inputs of the processor,
	 * it actually refers to the hash of the sources plus the hash of the dependencies
	 * @return {number}
	 */
	#inputs;
	get inputs() {
		if (this.#inputs !== void 0) return this.#inputs;

		const { sources } = this;
		const inheritance = this._compute();
		if (inheritance === 0) return (this.#inputs = sources);

		const compute = { sources, inheritance };
		return (this.#inputs = crc32(equal.generate(compute)));
	}

	get synchronized() {
		const sh = this.children.get('sources.hash').child;
		if (!sh.synchronized) return false;

		const roots = this.#extensions;
		return [...sh.extensions].reduce((prev, [processor, hash]) => prev && roots.get(processor) === hash, true);
	}

	constructor(processor) {
		super();
		this.#processor = processor;
		// super.setup(new Map([['sources.hash', { child: processor.sources.hash }]]));
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

	_process() {
		this.#inputs = void 0;
		const sh = this.children.get('sources.hash').child;
		this.#extensions = new Map(sh.extensions);
	}
};
