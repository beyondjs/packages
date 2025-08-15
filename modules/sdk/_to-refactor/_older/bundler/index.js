const DynamicProcessor = require('@beyond-js/dynamic-processor')();

/**
 * Bundler abstract class
 */
module.exports = class extends DynamicProcessor {
	get dp() {
		return 'bundler.conditional';
	}

	#module;
	get module() {
		return this.#module;
	}

	#platform;
	get platform() {
		return this.#platform;
	}

	get id() {
		return `${this.module.id}//${this.#platform}`;
	}

	#code;
	get code() {
		return this.#code;
	}

	#hash;
	get hash() {
		return this.#hash;
	}

	#processors;
	get processors() {
		return this.#processors;
	}

	#dependencies;
	get dependencies() {
		return this.#dependencies;
	}

	#consumers;
	get consumers() {
		return this.#consumers;
	}

	constructor(module, { platform, extname }) {
		super();
		this.#module = module;
		this.#platform = platform;

		// super.setup(new Map([['bundle', { child: bundle }]]));

		// this.#processors = new (require('./processors'))(this);
		// this.#dependencies = new (require('./dependencies'))(this);
		// this.#hash = new (require('./hash'))(this);
		// this.#consumers = new (require('./consumers'))(this);

		// const meta = bundle.application.bundles.get(bundle.type);
		// if (!(meta.extname instanceof Array)) {
		// 	throw new Error(`Property extname in bundle "${bundle.type}" specification must be an array`);
		// }
		// if (!meta.extname.includes('.js') && !meta.extname.includes('.css')) {
		// 	throw new Error(
		// 		`Property extname in bundle "${bundle.type}" specification must include the entries '.js' and/or '.css'`
		// 	);
		// }

		// const JsCode = meta.bundle?.Js ? meta.bundle.Js : require('./code/js');
		// this.#js = meta.extname.includes('.js') ? new JsCode(this) : void 0;

		// const CssCode = meta.bundle?.Css ? meta.bundle.Css : require('./code/css');
		// this.#css = meta.extname.includes('.css') ? new CssCode(this) : void 0;

		// this.#declaration = new (require('./declaration'))(this);
	}
};
