import type { IDiagnostic } from '@beyond-js/packages/types';
import { DynamicProcessor } from '@beyond-js/dynamic-processor/main';
import { equal } from '@beyond-js/equal/main';

export class ProcessorInputsSpec extends DynamicProcessor() {
	get dp() {
		return 'bundler.processor.sources.spec';
	}

	#processor;

	#errors: IDiagnostic[] = [];
	get errors(): IDiagnostic[] {
		return this.#errors;
	}

	#warnings: IDiagnostic[] = [];
	get warnings(): IDiagnostic[] {
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
}
