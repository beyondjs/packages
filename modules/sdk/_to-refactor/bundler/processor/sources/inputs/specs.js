const DynamicProcessor = require('@beyond-js/dynamic-processor')();
const equal = require('@beyond-js/equal');

module.exports = class extends DynamicProcessor {
	get dp() {
		return 'bundler.processor.sources.specs';
	}

	#processor;

	#errors = [];
	get errors() {
		return this.#errors;
	}

	#warnings = [];
	get warnings() {
		return this.#warnings;
	}

	get valid() {
		return !this.#errors.length;
	}

	#values;
	get values() {
		return this.#values;
	}

	constructor(processor) {
		super();
		this.#processor = processor;
		super.setup(new Map([['specs', { child: processor.specs }]]));
	}

	_process() {
		const specs = this.#processor.specs.values;

		const done = ({ errors, warnings, values }) => {
			errors = errors || [];
			warnings = warnings || [];
			const previous = { errors: this.#errors, warnings: this.#warnings, values: this.#values };
			equal({ errors, warnings, values }, previous);

			this.#errors = errors;
			this.#warnings = warnings;
			this.#values = values;
		};

		const warnings = [];

		let path,
			includes,
			excludes,
			other = {};

		if (typeof specs === 'string') {
			includes = [specs];
		} else if (specs instanceof Array) {
			includes = specs;
		} else if (typeof specs === 'object') {
			path = specs.path;
			includes = specs.files;
			includes = typeof includes === 'string' ? [includes] : includes;
			excludes = specs.excludes;

			delete specs.path;
			delete specs.files;
			delete specs.excludes;
			other = specs;
		} else if (specs === void 0) {
			includes = ['*'];
		} else {
			return done({ errors: ['Invalid configuration'] });
		}

		if (!(includes instanceof Array)) {
			return done({ errors: ['Files configuration not set'] });
		}

		excludes = excludes ? excludes : [];
		if (!(excludes instanceof Array)) {
			warnings.push(`Excludes configuration is invalid`);
			excludes = [];
		}

		!excludes.includes('module.json') && excludes.push('module.json');
		path = path ? path : '';

		const values = Object.assign({ path, includes, excludes }, other);
		return done({ warnings: warnings, values });
	}
};
