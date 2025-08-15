const DynamicProcessor = require('@beyond-js/dynamic-processor')();
const equal = require('@beyond-js/equal');

export class ManifestModuleSpec extends DynamicProcessor {
	get dp() {
		return 'module.specs';
	}

	#module;

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

	#subpath;
	get subpath() {
		return this.#subpath;
	}

	#description;
	get description() {
		return this.#description;
	}

	/**
	 * Bundler specs (dynamic processor) as they are defined in the module.json file
	 */
	#source;
	get source() {
		return this.#source;
	}

	/**
	 * Processed values of the specs
	 */
	#values;
	get values() {
		return this.#values;
	}

	constructor(module, source) {
		super();
		this.#module = module;
		this.#source = source;

		super.setup(new Map([['source', { child: source }]]));
	}

	_process() {
		const done = ({ errors, warnings, values }) => {
			errors = errors ? errors : [];
			warnings = warnings ? warnings : [];

			const previous = { errors: this.#errors, warnings: this.#warnings, values: this.#values };
			const changed = !equal(previous, { errors, warnings, values });
			if (!changed) return false;

			this.#errors = errors;
			this.#warnings = warnings;
			this.#values = values;
		};

		const { subpath, description } = this.#source.values;
		this.#subpath = subpath;
		this.#description = description;

		const original = Object.assign({}, this.#source.values);
		delete original.id;
		delete original.bundler;
		delete original.subpath;
		delete original.description;

		const { errors, warnings, values } = this.#module._specs(original);
		return done({ errors, warnings, values });
	}
}
