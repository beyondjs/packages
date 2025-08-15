const DynamicProcessor = require('@beyond-js/dynamic-processor')(Map);
const Item = require('./item');

module.exports = class extends DynamicProcessor {
	get dp() {
		return 'processor.extender.preprocessor';
	}

	#extensions;
	get extensions() {
		return this.#extensions;
	}

	#errors = [];
	get errors() {
		return this.#errors;
	}

	#warnings = [];
	get warnings() {
		return this.#warnings;
	}

	get valid() {
		return !this.#errors?.length;
	}

	#processor;
	get processor() {
		return this.#processor;
	}

	constructor(processor, extensions) {
		super();
		this.#processor = processor;
		this.#extensions = extensions;

		super.setup(new Map([['inputs', { child: processor.sources.inputs }]]));
	}

	_prepared(require) {
		this.#processor.sources.inputs.forEach(source => require(source));
	}

	async _preprocess(input) {
		void input;
		throw new Error(`Method '._preprocess' must be overridden`);
	}

	async _process(request) {
		const { sources } = this.processor;
		const updated = new Map();

		for (const input of sources.inputs.values()) {
			let item = this.has(input.relative.input) && this.get(input.relative.input);
			if (item?.hash === input.hash) {
				updated.set(input.relative.input, item);
				continue;
			}

			item = new Item(input, this.#extensions);
			updated.set(input.relative.file, item);

			await this._preprocess(item);
			if (this._request !== request) return;
		}

		const changed =
			this.size !== updated.size ||
			![...this.keys()].every(key => updated.has(key) && updated.get(key).hash === this.get(key).hash);

		this.clear();
		updated.forEach((value, key) => this.set(key, value));
		return changed;
	}

	serialize() {
		return {
			errors: this.#errors,
			warnings: this.#warnings
		};
	}

	hydrate(cached) {
		this.#errors = cached.errors ? cached.errors : [];
		this.#warnings = cached.warnings ? cached.warnings : [];
	}
};
