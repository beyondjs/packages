const Items = require('./items');
const DynamicProcessor = require('@beyond-js/dynamic-processor')(Map);

module.exports = class ProcessorOutputs extends DynamicProcessor {
	get dp() {
		return 'processor.outputs.base';
	}

	#processor;
	get processor() {
		return this.#processor;
	}

	/**
	 * The output type of the processor.
	 * @type {['ims', 'types', 'css']}
	 */
	#type;
	get type() {
		return this.#type;
	}

	#issues;
	get issues() {
		return this.#issues;
	}

	#generated;
	get generated() {
		return this.#generated;
	}

	/**
	 * The hash of the sources set when the output was last built.
	 * This is used to determine if the output needs to be rebuilt.
	 */
	#hash;
	get hash() {
		return this.#hash;
	}

	get updated() {
		return this.#processor.sources.hash.value === this.#hash;
	}

	constructor(processor, type) {
		if (!processor.sources) {
			throw new Error('The processor must have sources');
		}

		super();
		this.#processor = processor;
		this.#type = type;

		super.setup(new Map([['sources', { child: processor.sources.hash }]]));
	}

	async _begin() {
		const { store } = this.#processor.conditional;
		const cached = await store.outputs.fetch(this.#processor.name, this.#type);
		cached && this.hydrate(cached);
	}

	async _build(request, items) {
		void request, items;
		throw new Error(`Method '._build' must be overridden`);
	}

	async _process(request) {
		void request;
		if (this.updated) return false;

		const items = new Items();
		await this._build(request, items);
		if (request !== this._request) return;

		this.#hash = this.#processor.sources.hash.value;

		this.#issues = items.issues;
		this.#generated = items.generated;
		this.clear();
		items.forEach((item, key) => this.set(key, item));
	}

	hydrate(cached) {
		this.#hash = cached.hash;
	}

	serialize(json) {
		json = json || {};
		return Object.assign({ hash: this.#hash }, json);
	}
};
