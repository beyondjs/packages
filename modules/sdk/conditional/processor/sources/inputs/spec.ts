import type { ConditionalProcessor } from '../..';
import type { IDiagnostic } from '@beyond-js/packages/types';
import { DynamicProcessor } from '@beyond-js/dynamic-processor/main';
import { equal } from '@beyond-js/equal/main';

export interface IValues {
	path: string;
	includes: string[];
	excludes: string[];
	[key: string]: any;
}

interface IDone {
	errors?: IDiagnostic[];
	warnings?: IDiagnostic[];
	values?: IValues;
}

export class ProcessorInputsSpec extends DynamicProcessor() {
	get dp() {
		return 'bundler.processor.sources.spec';
	}

	#processor: ConditionalProcessor;

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

	#values: IValues;
	get values(): IValues {
		return this.#values;
	}

	constructor(processor: ConditionalProcessor) {
		super();
		this.#processor = processor;
		super.setup(new Map([['spec', { child: processor.spec }]]));
	}

	_process() {
		// The specification is copied: reading it must not alter the values the processor observes
		const observed = this.#processor.spec.values;
		const spec = observed && typeof observed === 'object' && !(observed instanceof Array) ? { ...observed } : observed;

		// Only a change of the selection reconfigures the collection of files, which then reprocesses
		const done = ({ errors, warnings, values }: IDone) => {
			errors = errors || [];
			warnings = warnings || [];
			const previous = { errors: this.#errors, warnings: this.#warnings, values: this.#values };
			const changed = !equal({ errors, warnings, values }, previous);

			this.#errors = errors;
			this.#warnings = warnings;
			this.#values = values;
			return changed;
		};

		const warnings: IDiagnostic[] = [];

		let path: string,
			includes: string[],
			excludes: string[],
			other = {};

		if (typeof spec === 'string') {
			includes = [spec];
		} else if (spec instanceof Array) {
			includes = spec;
		} else if (typeof spec === 'object') {
			path = spec.path;
			includes = spec.files;
			includes = typeof includes === 'string' ? [includes] : includes;

			// A specification that configures the processor without selecting files takes all of them,
			// as an absent specification does
			includes = includes === void 0 ? ['*'] : includes;
			excludes = spec.excludes;

			delete spec.path;
			delete spec.files;
			delete spec.excludes;
			other = spec;
		} else if (spec === void 0) {
			includes = ['*'];
		} else {
			const code = 'INVALID_CONFIGURATION';
			const message = 'Invalid configuration';
			return done({ errors: [{ code, message }] });
		}

		if (!(includes instanceof Array)) {
			const code = 'INVALID_INCLUDES_CONFIGURATION';
			const message = `Includes configuration is invalid. An array of strings is expected, but got ${typeof includes}.`;
			return done({ errors: [{ code, message }] });
		}

		excludes = excludes ? excludes : [];
		if (!(excludes instanceof Array)) {
			const code = 'INVALID_EXCLUDES_CONFIGURATION';
			const message = `Excludes configuration is invalid. An array of strings is expected, but got ${typeof excludes}.`;
			return done({ errors: [{ code, message }] });
		}

		!excludes.includes('module.json') && excludes.push('module.json');
		path = path ? path : '';

		const values: IValues = Object.assign({ path, includes, excludes }, other);
		return done({ warnings: warnings, values });
	}
}
