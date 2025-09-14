import type { IDiagnostic } from '@beyond-js/packages/types';
import type { ConditionalProcessor } from './';
import { DynamicProcessor } from '@beyond-js/dynamic-processor/main';
import { equal } from '@beyond-js/equal/main';

/**
 * The settings values as defined in the package.json file for the bundler.
 * If no settings are defined an empty object is used.
 * The settings for the processor are defined in the "processors" section, using the processor name as the key.
 * If no settings are defined for the processor an empty object is used.
 *
 * Example:
 * "bundlers": {
 * 		"code": {
 * 			"specifier": "@beyond-js/bundler-code/module",
 * 			"processors": {
 * 				"ts": { ... }
 * 			}
 * 		}
 * }
 */

export class ProcessorSettings extends DynamicProcessor() {
	get dp() {
		return 'processor.settings';
	}

	#processor: ConditionalProcessor;
	get processor(): ConditionalProcessor {
		return this.#processor;
	}

	#values = {};
	get values() {
		return this.#values;
	}

	#errors: IDiagnostic[] = [];
	get errors(): IDiagnostic[] {
		return this.#errors;
	}
	#warnings: IDiagnostic[] = [];
	get warnings(): IDiagnostic[] {
		return this.#warnings;
	}
	get valid() {
		return !this.#errors?.length;
	}

	constructor(processor: ConditionalProcessor) {
		super();
		this.#processor = processor;
		const bundler = processor.conditional.module.bundler;

		super.setup(new Map([['bundler', { child: bundler }]]));
	}

	_process() {
		const { bundler } = this.#processor.conditional.module;
		const { processors } = bundler.settings;

		let values = processors?.[this.#processor.name];
		values = values || {};

		let errors, warnings;
		({ values, errors, warnings } = this.#processor._settings(values));

		const previous = { errors: this.#errors, warnings: this.#warnings, values: this.#values };
		const changed = !equal({ values, errors, warnings }, previous);
		if (!changed) return false;

		this.#errors = errors || [];
		this.#warnings = warnings || [];
		this.#values = values;
	}
}
