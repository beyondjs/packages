import type { IProcessedSpec } from '@beyond-js/packages/module';
import type { ExportsType, ExportsTargetType } from '@beyond-js/packages/types';
import type { IDiagnostic } from '@beyond-js/packages/types';
import type { BuildResult } from 'esbuild';
import { BaseConditional } from '@beyond-js/packages/module';
import { ConditionalOutput } from '@beyond-js/packages/module/output';
import { build } from 'esbuild';
import { Plugin } from './plugin';
import * as lexer from 'cjs-module-lexer';
import { Wrapper } from './wrapper';
import { sep } from 'path';

export class Conditional extends BaseConditional {
	get dp() {
		return 'exports-bundler.outputs';
	}

	#errors: IDiagnostic[] = [];
	get errors(): IDiagnostic[] {
		return this.#errors;
	}

	get valid(): boolean {
		return !this.#errors.length;
	}

	#target: string;
	_spec(spec: ExportsType): IProcessedSpec {
		this.#target = (<any>spec).node.require;
		return { values: this.#target };
	}

	#output: ConditionalOutput = new ConditionalOutput();
	get output(): ConditionalOutput {
		return this.#output;
	}

	async _process(): Promise<void | boolean> {
		this.#output = void 0;

		if (!this.#target) {
			const code = 'NO_TARGET';
			const message = 'No target defined for the conditional';
			this.#errors = [{ code, message }];
			return;
		}

		const entry = this.#target;
		if (typeof entry !== 'string' || !entry) {
			const code = 'INVALID_TARGET';
			const message = `Invalid target: ${entry}`;
			this.#errors = [{ code, message }];
			return;
		}
		console.log('Building exports with entry:', entry);

		let result: BuildResult;
		const plugin = new Plugin(this);
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
			this.#errors = [{ code, message }];
			return;
		}

		const { warnings, outputFiles: outputs } = result;
		if (result.errors?.length) {
			const code = 'BUNDLER_ERRORS';
			const message = 'Errors found during the bundling process';
			this.#errors = [{ code, message }];
			return;
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

		this.#errors = [];
		this.#output.set({ code, map });

		require('fs').writeFileSync(`${process.cwd()}/output.js`, code);
		console.log('Build output code written to output.js');
	}
}
