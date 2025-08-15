const crc32 = require('@beyond-js/crc32');
const fs = require('@beyond-js/fs');
const { File } = require('@beyond-js/finder');
const DynamicProcessor = require('@beyond-js/dynamic-processor')(File);
const { join } = require('path');

module.exports = class extends DynamicProcessor {
	get dp() {
		return 'bundler.processor.sources.file';
	}

	#processor;
	get processor() {
		return this.#processor;
	}

	#listener;

	#exists;
	get exists() {
		return this.#exists;
	}

	#errors = [];
	get errors() {
		return this.#errors;
	}

	get valid() {
		return !this.errors.length;
	}

	#content;
	get content() {
		return this.#content;
	}

	#hash;
	get hash() {
		if (this.#hash !== void 0) return this.#hash;
		return (this.#hash = this.#content ? crc32(this.#content) : 0);
	}

	#listen() {
		const { watcher } = this.#processor.conditional.module.package;
		if (!watcher) return;

		this.#listener?.destroy();
		this.#listener = watcher.listeners.create(this.file, { includes: [this.file] });
		this.#listener.listen().catch(exc => console.log(exc.stack));
		this.#listener.on('change', this._invalidate);
	}

	constructor(processor, file) {
		const root = processor.conditional.module.path.dirname;
		super(root, join(root, file));

		this.#processor = processor;
		this.#listen();
	}

	async _process(request) {
		this.#errors = [];
		this.#content = this.#hash = void 0;

		const exists = (this.#exists = !!(this.file && (await fs.exists(this.file))));
		if (request !== this._request) return;

		try {
			const content = exists ? await fs.readFile(this.file, 'utf8') : void 0;
			if (request !== this._request) return;
			this.#content = content;
		} catch (exc) {
			this.#errors.push(`Error reading file: ${exc.message}`);
		}
	}

	destroy() {
		super.destroy();
		this.#listener?.destroy();
	}
};
