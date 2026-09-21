import type { Conditional } from '../../main';
import type { ConditionalProcessor } from '../../processor';
import type { IProcessorsSetup } from '../../../conditional/main';
import { IDiagnostic } from '@beyond-js/packages/types';
import { DynamicProcessor } from '@beyond-js/dynamic-processor/main';
import { equal } from '@beyond-js/equal/main';
import { importer } from './importer';

interface IDone {
	errors?: IDiagnostic[];
	warnings?: IDiagnostic[];
	updated?: Map<string, ConditionalProcessor>;
}

/**
 * The processors of a conditional, created from what its `_processors()` configures.
 *
 * A processor is identified by its name and by the implementation that name selects. A configuration that
 * keeps the name but selects another specifier replaces the instance: the previous constructor is destroyed
 * and the new one imported, so an alias never keeps an implementation that the configuration no longer
 * names. A configuration that fails destroys every processor, because a conditional with configuration
 * errors has no valid processors to build with.
 */
export /*bundle*/ class ConditionalProcessors extends DynamicProcessor(Map<string, ConditionalProcessor>) {
	get dp() {
		return 'bundler.processors';
	}

	#conditional: Conditional;
	get conditional(): Conditional {
		return this.#conditional;
	}

	/**
	 * The specifier each processor was imported from, which is what tells a replaced implementation apart
	 */
	#specifiers: Map<string, string> = new Map();

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

	async _process() {
		const done = ({ errors, warnings, updated }: IDone) => {
			updated = updated ?? new Map();
			const previous = { errors: this.#errors, warnings: this.#warnings };
			const changed =
				!equal({ errors, warnings }, previous) ||
				updated.size !== this.size ||
				[...updated.entries()].some(([key, processor]) => this.get(key) !== processor);
			if (!changed) return false;

			this.#errors = errors || [];
			this.#warnings = warnings || [];

			// Destroy the processors that are no longer configured, or that were replaced
			this.forEach((processor, name) => updated.get(name) !== processor && processor.destroy());
			this.#specifiers.forEach((specifier, name) => !updated.has(name) && this.#specifiers.delete(name));

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

			// The same name selecting the same implementation keeps its instance and receives the new spec
			if (this.has(name) && this.#specifiers.get(name) === specifier) {
				updated.set(name, this.get(name));
				this.get(name).spec.values = spec;
				continue;
			}

			const { module } = this.#conditional;

			// The diagnostics of a processor that could not be imported are added to the ones already
			// collected, so configuring several processors reports every failure
			const imported = await importer(specifier, module.package.path);
			if (imported.errors?.length) {
				imported.errors.forEach(error => errors.push(error));
				continue;
			}
			const { Processor } = imported;

			try {
				const processor = new Processor(this.#conditional, name);
				processor.spec.values = spec;

				updated.set(name, processor);
				this.#specifiers.set(name, specifier);
			} catch (exc) {
				const code = 'PROCESSOR_INITIALIZATION_ERROR';
				const message = `Error requiring processor "${specifier}": ${exc.message}`;
				errors.push({ code, message });
				continue;
			}
		}
		return done({ errors, warnings, updated });
	}

	clear() {
		this.forEach(processor => processor.destroy());
		this.#specifiers.clear();
		super.clear();
	}

	destroy() {
		this.clear();
		super.destroy();
	}
}
