const SourceMap = require('@beyond-js/bundlers-sdk/source-map');
const DynamicProcessor = require('@beyond-js/dynamic-processor')();
const ipc = require('@beyond-js/ipc/main');

module.exports = class extends DynamicProcessor {
	get dp() {
		return 'module.conditional.bundler';
	}

	#module;
	get module() {
		return this.#module;
	}

	#conditions;
	get conditions() {
		return conditions;
	}

	get id() {
		return `${this.#module.id}//${this.#conditions.platform}`;
	}

	#hash;
	#cache;

	#errors;
	get errors() {
		this.__update();
		return this.#errors ? this.#errors : [];
	}

	get valid() {
		return this.processed && !this.errors.length;
	}

	#sourcemaps = {};

	constructor(module, conditions) {
		super();
		this.#module = module;
		this.#conditions = conditions;
		// this.#cache = new (require('./cache'))(this);

		super.setup(new Map([['hash', { child: distribution.hash }]]));
	}

	code(hmr) {
		this.__update(hmr);
		return this.#sourcemaps[hmr ? 'hmr' : 'code']?.code;
	}

	map(hmr) {
		this.__update(hmr);
		return this.#sourcemaps[hmr ? 'hmr' : 'code']?.map;
	}

	_notify() {
		const message = {
			type: 'change',
			specifier: this.#module.specifier,
			vspecifier: this.#module.vspecifier,
			extname: this.#extname,
			conditions: conditions.key
		};
		ipc.notify('modules-conditions', message);
	}

	async _begin() {
		const cached = await this.#cache.load();
		cached && this.hydrate(cached);

		await this.#distribution.ready;
	}

	get updated() {
		const hash = this.children.get('hash').child;
		return hash.value === this.#hash;
	}

	_prepared(require) {
		if (this.updated) return;

		const ext = this.#extname === '.js' ? 'js' : 'css';

		if (!this.children.has('processors')) {
			const distribution = this.#distribution;

			const children = new Map();
			children.set('processors', { child: distribution.processors });
			this.children.register(children);
		}

		const processors = this.children.get('processors').child;
		if (!require(processors)) return;

		// Check that all processors distributions are prepared and synchronized
		const synchronized = (() => {
			let synchronized = true;
			processors.forEach(processor => {
				const distribution = processor.distribution?.[ext];
				if (!distribution) return;

				if (!require(distribution)) return;
				synchronized = synchronized && distribution.synchronized;
			});
			return synchronized;
		})();
		if (!synchronized) return 'processors distributions are not synchronized';
	}

	_process() {
		if (this.updated && !this.#sourcemaps.code && !this.#sourcemaps.hmr && !this.#errors?.length) {
			throw new Error('Sourcemap or errors should be defined');
		}
		if (this.updated) return false;

		this.#hash = this.#errors = void 0;
		this.#sourcemaps = {};
	}

	// This method is overwritten by the js and css code processors
	_update(hmr) {
		void hmr;
		throw new Error('This method must be overridden');
	}

	__update(hmr) {
		let sourcemap = hmr ? this.#sourcemaps.hmr : this.#sourcemaps.code;
		if (sourcemap || this.#errors?.length) return; // Already processed
		if (!this.processed) {
			throw new Error('Processor is not ready. Wait for the .ready property before accessing its state.');
		}

		const done = ({ sourcemap, errors }) => {
			this.#hash = this.children.get('hash').child.value;
			this.#sourcemaps[hmr ? 'hmr' : 'code'] = sourcemap;
			this.#errors = errors ? errors : [];

			// Save the code into cache
			!hmr && this.#cache.save();
		};

		if (hmr && !this.children.has('processors')) {
			const message =
				'HMR code or map cannot be requested if the processor is up-to-date ' +
				'and it has been previously obtained from cache';
			const sourcemap = new SourceMap();
			sourcemap.concat(`// ${message}`);
			return done({ sourcemap });
		}

		let processors = this.children.get('processors').child;

		// Filter the processors that implement the corresponding code extension (.js or .css)
		const ext = this.#extname === '.js' ? 'js' : 'css';

		// Check if any of the processors is not in a valid state
		let errors = [];
		let count = (this.#processorsCount = 0);
		for (const [name, { distribution }] of processors) {
			if (!distribution) continue;
			if (!distribution[ext]) continue; // Distribution doesn't support the extname of the bundle being processed

			// Legacy processors "scss" and "less" injects the css code in the .js bundle, not .css bundle is supported
			// if (['scss', 'less'].includes(name) && this.#extname === '.css') continue;

			count++;
			!distribution[ext].valid && errors.push(`Processor "${name}" has been compiled with errors.`);
		}

		this.#processorsCount = count;
		if (errors.length) return done({ errors });

		// Update the code
		({ sourcemap, errors } = this._update(hmr));
		if (sourcemap && errors?.length)
			throw new Error('Only sourcemap or errors should be returned from processor code');
		if (!sourcemap && !errors?.length)
			throw new Error('Processor code distribution should return a sourcemap or errors');

		done({ sourcemap, errors });
	}

	hydrate(cached) {
		const { hash, sourcemap, processorsCount, errors } = cached;
		this.#hash = hash;
		this.#sourcemaps.code = sourcemap;
		this.#processorsCount = processorsCount;
		this.#errors = errors;
	}

	toJSON() {
		const hash = this.#hash;
		const sourcemap = (() => {
			if (!this.#sourcemaps.code) return;
			const { code, map } = this.#sourcemaps.code;
			return { code, map };
		})();

		const errors = this.#errors;
		const processorsCount = this.#processorsCount;
		return { hash, sourcemap, processorsCount, errors };
	}
};
