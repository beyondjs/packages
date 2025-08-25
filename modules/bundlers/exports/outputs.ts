import type { Conditional } from './conditional';
import type { OutputsType, IOutput } from '@beyond-js/packages/module';
import type { IDiagnostic } from '@beyond-js/packages/types';
import type { BuildResult } from 'esbuild';
import { DynamicProcessor } from '@beyond-js/dynamic-processor/main';
import { build } from 'esbuild';
import { Plugin } from './esbuild-plugin';
import { sep } from 'path';

interface IDone {
	errors?: IDiagnostic[];
	updated?: Map<string, IOutput>;
}

export class Outputs extends DynamicProcessor(Map<string, IOutput>) implements OutputsType {
	get dp() {
		return 'exports-bundler.outputs';
	}

	#conditional: Conditional;

	#errors: IDiagnostic[] = [];
	get errors(): IDiagnostic[] {
		return this.#errors;
	}

	valid(): boolean {
		return !this.#errors.length;
	}

	constructor(conditional: Conditional) {
		super();
		this.#conditional = conditional;

		super.setup(new Map([['conditional', { child: conditional.spec }]]));
	}

	async _process(): Promise<void> {
		const errors: IDiagnostic[] = [];
		const updated: Map<string, IOutput> = new Map();

		const done = ({ errors, updated }: IDone) => {
			errors = errors || [];
			updated = updated || new Map();
		};

		const { valid } = this.#conditional.spec;
		if (!valid) {
			const code = 'INVALID_CONDITIONAL_SPEC';
			errors.push({ code, message: 'Invalid conditional spec' });
			return done({ errors, updated });
		}

		const entry = <string>this.#conditional.spec.values;
		console.log('Building exports with entry:', entry);

		const plugin = new Plugin();

		let result: BuildResult;
		try {
			result = await build({
				entryPoints: [entry],
				sourcemap: 'external',
				logLevel: 'silent',
				platform: 'browser',
				format: 'esm',
				bundle: true,
				write: false,
				outfile: 'out.js',
				plugins: [plugin]
			});
		} catch (exc) {
			console.log('Build exception', exc);
			const code = 'BUNDLER_EXCEPTION';
			const message = `Exception caught: ${exc.message}`;
			return done({ errors: [{ code, message }] });
		}

		const { warnings, outputFiles: outputs } = result;
		if (result.errors?.length) {
			const code = 'BUNDLER_ERRORS';
			const message = 'Errors found during the bundling process';
			return done({ errors: [{ code, message }] });
		}

		const { code, map } = (() => {
			const output = { code: '', map: '' };
			output.code = outputs?.find(({ path }) => path.endsWith(`${sep}out.js`))?.text;
			output.map = outputs?.find(({ path }) => path.endsWith(`${sep}out.js.map`))?.text;
			return output;

			// const requires = resolveRequireCalls(plugin);
			// if (!requires) return output;

			// const sourcemap = new SourceMap();
			// sourcemap.concat(requires.imports);
			// sourcemap.concat(requires.resolver);
			// sourcemap.concat(output.code, void 0, output.map);
			// return sourcemap;
		})();

		console.log('Build finished', { code, map });
	}
}
