import type { Conditional, ProcessorOutputs } from '@beyond-js/packages/sdk';
import type { IRequest } from '@beyond-js/dynamic-processor/main';
import type { IDiagnostic } from '@beyond-js/packages/types';
import { ConditionalProcessor } from '@beyond-js/packages/sdk';
import { join } from 'path';
import { Dependencies } from './dependencies';
import { Sass } from './sass';
import { Tailwind, type ITailwindSettings } from './tailwind';

export type { ITailwindSettings } from './tailwind';

/**
 * Compiles the stylesheets of a public module: its `.css` and `.scss` sources, each into one style output
 * that the conditional concatenates, in file order, into the stylesheet of the module.
 *
 * A source is compiled with Sass, or with Tailwind when it imports it. Partials (`_name.scss`) produce
 * nothing of their own. What a compilation reads besides its source (partials, a theme, the sources
 * Tailwind scans, a plugin) is watched as a dependency of the processor, so editing any of it rebuilds
 * the stylesheet; a dependency a later build no longer reads is released. Nothing is scanned outside the
 * module directory: the Tailwind sources are the ones the module manifest declares.
 */
export /*bundle*/ class Processor extends ConditionalProcessor {
	#dependencies: Dependencies;

	/**
	 * The files the last build read besides its inputs
	 */
	get dependencies(): string[] {
		return this.#dependencies.files;
	}

	#diagnostics: IDiagnostic[] = [];
	get errors(): IDiagnostic[] {
		return this.#diagnostics.concat(super.errors);
	}

	constructor(conditional: Conditional, name: string) {
		super(conditional, name, { sources: { inputs: { extname: ['.css', '.scss', '.sass'] } } });
		this.#dependencies = new Dependencies(this);
	}

	/**
	 * Besides the selection of the inputs, the processor keeps the tailwind inputs the manifest declares,
	 * so changing them reprocesses the module
	 */
	_spec(values: any) {
		const { values: output, errors, warnings } = super._spec(values);
		const errors2: IDiagnostic[] = errors ? [...errors] : [];
		if (values?.tailwind !== void 0) {
			const { tailwind } = values;
			const valid = tailwind && typeof tailwind === 'object' && !(tailwind instanceof Array) &&
				(tailwind.sources === void 0 || (tailwind.sources instanceof Array && tailwind.sources.every((source: unknown) => typeof source === 'string' && source)));
			valid ? (output.tailwind = { sources: tailwind.sources }) : errors2.push({ code: 'TAILWIND_INVALID', message: 'The "tailwind" of the module manifest must be an object whose "sources" are paths relative to the module' });
		}
		return { values: output, errors: errors2, warnings };
	}

	async _build(request: IRequest, outputs: ProcessorOutputs): Promise<void> {
		const { module } = this.conditional;
		const directory = join(module.package.path, module.spec.path ?? '');
		const settings = <ITailwindSettings>(<{ tailwind?: ITailwindSettings }>this.spec.values).tailwind;
		const tailwind = new Tailwind(directory, module.package.path);
		const read = new Set<string>();
		const diagnostics: IDiagnostic[] = [];

		for (const input of [...this.sources.inputs.values()].sort((a, b) => a.relative.file.localeCompare(b.relative.file))) {
			if (Sass.partial(input.file)) continue;

			const output = outputs.styles.obtain(input);
			if (!input.valid) {
				output.issues.push('errors', { code: 'SOURCE_ERROR', message: input.errors.join('; ') });
				continue;
			}

			const relative = input.relative.file.replace(/\\/g, '/');
			const compiled = Tailwind.uses(input.content)
				? await tailwind.compile(input.file, input.content, settings, relative)
				: Sass.compile(input.file, input.content, relative);
			if (request !== this._request) return;

			compiled.read.forEach(file => read.add(file));
			compiled.diagnostics.forEach(diagnostic => output.issues.push('errors', diagnostic));
			typeof compiled.code === 'string' && output.code.set({ code: compiled.code, map: compiled.map });
		}

		// The dependencies of this build are watched from now on; the ones of the previous build no longer read are released
		try {
			await this.#dependencies.update(read);
		} catch (error) {
			diagnostics.push({ code: 'STYLE_DEPENDENCY_ERROR', message: error.message });
		}
		if (request !== this._request) return;
		this.#diagnostics = diagnostics;
	}

	destroy() {
		super.destroy();
		this.#dependencies.destroy();
	}
}
