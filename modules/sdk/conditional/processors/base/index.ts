import type { Conditional } from '../../main';
import type { ConditionalProcessor } from '../../processor';
import type { IProcessorsSetup } from '../../../conditional/main';
import { IDiagnostic } from '@beyond-js/packages/types';
import { DynamicProcessor } from '@beyond-js/dynamic-processor/main';
import { equal } from '@beyond-js/equal/main';

interface IDone {
	errors?: IDiagnostic[];
	warnings?: IDiagnostic[];
	updated?: Map<string, ConditionalProcessor>;
}

/**
 * The processors of a bundler
 */
export /*bundle*/ class ConditionalProcessors extends DynamicProcessor(Map<string, ConditionalProcessor>) {
	get dp() {
		return 'bundler.processors';
	}

	#conditional: Conditional;
	get conditional(): Conditional {
		return this.#conditional;
	}

	#errors: IDiagnostic[] = [];
	get errors() {
		return this.#errors;
	}

	#warnings: IDiagnostic[] = [];
	get warnings() {
		return this.#warnings;
	}

	get valid() {
		return !this.#errors?.length;
	}

	constructor(conditional: Conditional) {
		super();
		this.#conditional = conditional;
	}

	/**
	 * Used to resolve the processor specifier if it is not provided in the processor data
	 * Actually used by the @beyond-js/bundlers-sdk/processors/resolver
	 *
	 * @param {string} name - The name of the processor to resolve
	 * @returns
	 */
	_resolve(name: string): { error?: { code: string; message: string }; specifier?: string } {
		const code = 'PROCESSOR_NOT_FOUND';
		const message = `Processor "${name}" not found in the bundler settings`;
		return { error: { code, message } };
	}

	_process() {
		const done = ({ errors, warnings, updated }: IDone) => {
			const previous = { errors: this.#errors, warnings: this.#warnings };
			const changed =
				!equal({ errors, warnings }, previous) ||
				updated.size !== this.size ||
				[...updated.entries()].some(([key]) => !this.has(key));
			if (!changed) return false;

			this.#errors = errors || [];
			this.#warnings = warnings || [];

			// Destroy unused processors
			this.forEach((processor, name) => !updated.has(name) && processor.destroy());

			super.clear(); // Do not use this.clear() as it would destroy still used processors
			updated.forEach((value, key) => this.set(key, value));
		};

		let { processors, errors, warnings }: IProcessorsSetup = this.#conditional._processors();
		errors = errors || [];
		warnings = warnings || [];
		if (errors.length) return done({ errors, warnings });

		const updated: Map<string, ConditionalProcessor> = new Map();
		for (const [name, spec] of processors.entries()) {
			let { specifier } = spec;
			if (!specifier) {
				const resolved = this._resolve(name);
				if (resolved.error) {
					errors.push(resolved.error);
					continue;
				}

				specifier = resolved.specifier;
			}

			if (this.has(name)) {
				updated.set(name, this.get(name));
				this.get(name).spec.values = spec;
				continue;
			}

			let resolved = null;
			try {
				const { module } = this.#conditional;
				resolved = require.resolve(specifier, { paths: [module.package.path] });
			} catch (exc) {
				console.error(exc);
				const code = 'PROCESSOR_NOT_FOUND';
				const message = `Error resolving processor "${specifier}": ${exc.message}`;
				errors.push({ code, message });
				continue;
			}

			try {
				const Processor = require(resolved);
				const processor = new Processor(this.#conditional, name, specifier);
				processor.spec.values = spec;

				updated.set(name, processor);
			} catch (exc) {
				console.error(exc);
				const code = 'PROCESSOR_NOT_FOUND';
				const message = `Error requiring processor "${specifier}": ${exc.message}`;
				errors.push({ code, message });
				continue;
			}
		}
		return done({ errors, warnings, updated });
	}

	clear() {
		this.forEach(processor => processor.destroy());
		super.clear();
	}

	destroy() {
		this.clear();
		super.destroy();
	}
}
