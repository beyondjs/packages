import type { IDiagnostic } from '@beyond-js/packages/types';
import type { ConditionalProcessors } from '../processors/base';
import type { ProcessorOutput } from '../processor/outputs/output';
import type { IInternalModule } from './';
import { ConditionalOutput } from '@beyond-js/packages/module/output';
import Concat from 'concat-with-sourcemaps';

/**
 * What the processors of a conditional produced, read in one pass and in a stable order.
 *
 * Processors are visited by name and their outputs by source file, so the artifact, the stylesheet and the
 * declaration of a module do not depend on the order in which files were discovered or builds completed.
 * The issues every output reports are collected as diagnostics that name the file and the position; a
 * source whose transformation failed invalidates the whole module, which is not published while one of
 * its parts is missing.
 */
export class Outputs {
	#ims: IInternalModule[] = [];
	get ims() {
		return this.#ims;
	}

	#styles: ProcessorOutput[] = [];
	#types: ProcessorOutput[] = [];

	#errors: IDiagnostic[] = [];
	get errors() {
		return this.#errors;
	}

	#warnings: IDiagnostic[] = [];
	get warnings() {
		return this.#warnings;
	}

	/**
	 * @param processors The processors of the conditional, which must be ready
	 * @param id How the identity of an internal module derives from its file
	 * @param hash How the content of an internal module is hashed
	 */
	constructor(processors: ConditionalProcessors, id: (file: string) => string, hash: (code: string) => number) {
		const names = [...processors.keys()].sort();
		for (const name of names) {
			const processor = processors.get(name);
			if (!processor.valid) {
				processor.errors.forEach(error => this.#errors.push(error));
				continue;
			}
			processor.warnings?.forEach(warning => this.#warnings.push(warning));
			if (!processor.outputs) continue;

			const sorted = (collection: Map<string, ProcessorOutput>) => [...collection.keys()].sort().map(key => collection.get(key));

			sorted(processor.outputs.ims).forEach(im => {
				this.#issues(im);
				const code = im.code.code();
				if (typeof code !== 'string') return;
				const file = im.source.relative.file;
				this.#ims.push({ id: id(file), hash: hash(code), output: im });
			});

			sorted(processor.outputs.styles).forEach(output => {
				this.#issues(output);
				typeof output.code.code() === 'string' && this.#styles.push(output);
			});

			sorted(processor.outputs.types).forEach(output => {
				this.#issues(output);
				typeof output.code.code() === 'string' && this.#types.push(output);
			});
		}
	}

	#issues(output: ProcessorOutput) {
		const file = output.source?.relative.file ?? '';
		const format = ({ code, message, position }: { code: string; message: string; position?: { line?: number; column?: number } }): IDiagnostic => {
			const at = position?.line ? ` (${position.line}:${position.column ?? 0})` : '';
			const located = position?.line ? { position: { line: position.line, column: position.column ?? 1 } } : {};
			return { code, message: `${file}${at}: ${message}`, ...(output.source ? { file: output.source.file } : {}), ...located };
		};
		output.issues.errors.forEach(issue => this.#errors.push(format(issue)));
		output.issues.warnings.forEach(issue => this.#warnings.push(format(issue)));
	}

	/**
	 * Concatenates outputs of one kind into one, preserving the source map of each part
	 *
	 * @returns undefined when there is nothing of that kind
	 */
	#concat(outputs: ProcessorOutput[], name: string): ConditionalOutput | undefined {
		if (!outputs.length) return;

		const concat = new Concat(true, name, '\n');
		outputs.forEach(output => {
			const file = output.source?.relative.file.replace(/\\/g, '/');
			try {
				concat.add(file ?? null, output.code.code(), output.code.map());
			} catch (error) {
				// A map that cannot be composed costs the map of that part, never the output of the module
				this.#warnings.push({ code: 'MAP_INVALID', message: `${file ?? name}: its source map was dropped: ${error.message}` });
				concat.add(file ?? null, output.code.code());
			}
		});

		const result = new ConditionalOutput();
		result.set({ code: concat.content.toString(), map: concat.sourceMap });
		return result;
	}

	/**
	 * The stylesheet of the module: every style output in order, or undefined when there is none
	 */
	styles(vspecifier: string): ConditionalOutput | undefined {
		return this.#concat(this.#styles, `${vspecifier}.css`);
	}

	/**
	 * The public declaration of the module, or undefined when no processor produced one
	 */
	types(vspecifier: string): ConditionalOutput | undefined {
		return this.#concat(this.#types, `${vspecifier}.d.ts`);
	}
}
