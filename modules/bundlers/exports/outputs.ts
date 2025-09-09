import type { Conditional } from './conditional';
import type { OutputsType, OutputNameType, IOutput } from '@beyond-js/packages/module';
import type { IDiagnostic } from '@beyond-js/packages/types';
import type { BuildResult } from 'esbuild';
import { DynamicProcessor } from '@beyond-js/dynamic-processor/main';
import { equal } from '@beyond-js/equal/main';
import { build } from 'esbuild';
import { Plugin } from './plugin';
import * as lexer from 'cjs-module-lexer';
import { Wrapper } from './wrapper';
import { sep } from 'path';

interface IDone {
	errors?: IDiagnostic[];
	updated?: Map<string, IOutput>;
}

export class Outputs extends DynamicProcessor(Map<OutputNameType, IOutput>) implements OutputsType {
	get dp() {
		return 'exports-bundler.outputs';
	}

	#conditional: Conditional;

	#errors: IDiagnostic[] = [];
	get errors(): IDiagnostic[] {
		return this.#errors;
	}

	get valid(): boolean {
		return !this.#errors.length;
	}

	constructor(conditional: Conditional) {
		super();
		this.#conditional = conditional;

		super.setup(new Map([['conditional', { child: conditional.spec }]]));
	}

	async _process(): Promise<void | boolean> {
		const errors: IDiagnostic[] = [];
		const updated: Map<string, IOutput> = new Map();

		const done = ({ errors, updated }: IDone) => {
			errors = errors || [];
			updated = updated || new Map();
			const previous = { errors: this.#errors };
			const changed = !equal(previous, { errors, updated });
			if (!changed) return false;

			this.#errors = errors;
		};

		const { valid } = this.#conditional.spec;
		if (!valid) {
			const code = 'INVALID_CONDITIONAL_SPEC';
			errors.push({ code, message: 'Invalid conditional spec' });
			return done({ errors, updated });
		}

		const entry = <string>this.#conditional.spec.values;
		if (typeof entry !== 'string' || !entry) {
			const code = 'INVALID_ENTRY';
			const message = `Invalid entry point: ${entry}`;
			errors.push({ code, message });
			return done({ errors, updated });
		}
		console.log('Building exports with entry:', entry);

		const plugin = new Plugin(this.#conditional);

		let result: BuildResult;
		try {
			result = await build({
				entryPoints: [entry],
				format: 'cjs',
				sourcemap: 'external',
				logLevel: 'silent',
				platform: 'browser',
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

		await lexer.init();

		const { code, map }: { code: string; map: string } = (() => {
			const output = { code: '', map: '' };
			output.code = outputs?.find(({ path }) => path.endsWith(`${sep}out.js`))?.text;
			output.map = outputs?.find(({ path }) => path.endsWith(`${sep}out.js.map`))?.text;

			const { exports } = lexer.parse(output.code);

			const wrap = new Wrapper();
			const externals = plugin.externals;

			const esm = wrap.build({ code: output.code, map: output.map, externals, exports });
			output.code = esm.code;
			output.map = esm.map;

			return output;
		})();

		require('fs').writeFileSync(`${process.cwd()}/output.js`, code);
		console.log('Build output code written to output.js');
	}
}
