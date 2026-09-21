import type { IProcessorsSetup } from '@beyond-js/packages/sdk';
import type { IProcessedSpec } from '@beyond-js/packages/module';
import type { IDiagnostic } from '@beyond-js/packages/types';
import { Conditional } from '@beyond-js/packages/sdk';
import { ConditionalOutput } from '@beyond-js/packages/module/output';
import { equal } from '@beyond-js/equal/main';
import { Spec } from './spec';

/**
 * The `types` conditional of a module compiled by the TypeScript bundler: the semantic check of its
 * sources and its public declaration.
 *
 * Its output is the declaration file of the public module, which consumers and editors resolve the bare
 * specifier of the module to. Its diagnostics are the semantic ones: an error of the program that the
 * executable conditionals, which transpile file by file, cannot see. It is not an executable artifact and
 * the delivery of code never selects it.
 */
export /*bundle*/ class Types extends Conditional {
	#output: ConditionalOutput;
	get output(): ConditionalOutput {
		return this.#output;
	}

	#errors: IDiagnostic[] = [];
	get errors(): IDiagnostic[] {
		return this.#errors.concat(super.errors);
	}

	#warnings: IDiagnostic[] = [];
	get warnings(): IDiagnostic[] {
		return this.#warnings.concat(super.warnings);
	}

	get valid(): boolean {
		return !this.#errors.length && super.valid;
	}

	_spec(values: Record<string, any>): IProcessedSpec {
		// The declaration of the module is the one of its first declared platform, with its entry point
		const platform = typeof values?.platforms === 'string' ? values.platforms : values?.platforms?.[0];
		return Spec.values(values, typeof platform === 'string' ? platform : 'default');
	}

	_processors(): IProcessorsSetup {
		const values = <Record<string, any>>this.spec.values;
		const specifier = '@beyond-js/packages/bundlers/ts/processors/tsc';
		return { processors: new Map([['types', Spec.processor(values, specifier)]]) };
	}

	_process(): boolean {
		const errors: IDiagnostic[] = [];
		const warnings: IDiagnostic[] = [];
		let output: ConditionalOutput;

		this.processors.forEach(processor => {
			processor.errors.forEach(error => errors.push(error));
			processor.warnings.forEach(warning => warnings.push(warning));
			processor.outputs?.types.forEach(declaration => {
				const file = declaration.source?.relative.file ?? '';
				declaration.issues.errors.forEach(({ code, message, position }) => {
					const at = position?.line ? ` (${position.line}:${position.column ?? 0})` : '';
					errors.push({ code, message: `${file}${at}: ${message}` });
				});
				declaration.issues.warnings.forEach(({ code, message, position }) => {
					const at = position?.line ? ` (${position.line}:${position.column ?? 0})` : '';
					warnings.push({ code, message: `${file}${at}: ${message}` });
				});

				const code = declaration.code.code();
				if (typeof code !== 'string') return;
				output = new ConditionalOutput();
				output.set({ code, map: void 0 });
			});
		});

		const previous = { errors: this.#errors, warnings: this.#warnings, hash: this.#output?.hash };
		const changed = !equal(previous, { errors, warnings, hash: output?.hash });
		this.#errors = errors;
		this.#warnings = warnings;
		this.#output = output;
		return changed;
	}
}
