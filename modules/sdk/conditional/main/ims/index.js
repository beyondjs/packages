const DynamicProcessor = require('@beyond-js/dynamic-processor')(Map);

module.exports = class extends DynamicProcessor {
	get dp() {
		return 'bundler.output.esm.processors';
	}

	#processors;

	constructor(processors) {
		super();
		this.#processors = processors;
	}

	_prepared(require) {
		if (!require(this.#processors)) return;

		for (const processor of this.#processors.values()) {
			const { ims } = processor.outputs;
			if (!ims) continue;
			require(ims);
		}
	}

	_process() {
		const updated = new Map();

		for (const processor of this.#processors.values()) {
			const { ims } = processor.outputs;
			if (!ims) continue;

			ims?.forEach((im, key) => updated.set(key, im));
		}

		const changed =
			this.size !== updated.size ||
			[...this.keys()].some(key => !updated.has(key)) ||
			updated.forEach((im, key) => this.get(key).hash !== im.hash);
		if (!changed) return false;

		this.clear();
		updated.forEach((im, key) => this.set(key, im));
	}
};
