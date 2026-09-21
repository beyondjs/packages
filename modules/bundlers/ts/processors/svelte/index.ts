import type { Conditional, ProcessorOutputs } from '@beyond-js/packages/sdk';
import type { IRequest } from '@beyond-js/dynamic-processor/main';
import { ConditionalProcessor } from '@beyond-js/packages/sdk';
import { Analyzer } from '@beyond-js/packages/bundlers/ts/processors/ts';
import { Component } from './component';

/**
 * Compiles the `.svelte` components of a public module into internal modules and stylesheets.
 *
 * A component `view.svelte` yields the internal module `./view`, which `import View from './view.svelte'`
 * resolves to, and one style output when it declares styles. The Svelte compiler this package pins does
 * the compilation; the Svelte runtime is a public dependency of the module, bare as any other.
 */
export /*bundle*/ class Processor extends ConditionalProcessor {
	constructor(conditional: Conditional, name: string) {
		super(conditional, name, { sources: { inputs: { extname: ['.svelte'] } } });
	}

	async _build(request: IRequest, outputs: ProcessorOutputs): Promise<void> {
		const { platform } = this.conditional;
		const analyses: Promise<void>[] = [];

		for (const input of this.sources.inputs.values()) {
			const output = outputs.ims.obtain(input);
			if (!input.valid) {
				output.issues.push('errors', { code: 'SOURCE_ERROR', message: input.errors.join('; ') });
				continue;
			}

			const relative = input.relative.file.replace(/\\/g, '/');
			const compiled = await new Component(input.file, relative, platform).compile(input.content);
			if (request !== this._request) return;

			compiled.diagnostics.forEach(diagnostic => output.issues.push('errors', diagnostic));
			compiled.warnings.forEach(warning => output.issues.push('warnings', warning));
			if (compiled.diagnostics.length) continue;

			output.code.set({ code: compiled.code, map: compiled.map });
			analyses.push(Analyzer.process(output));

			if (compiled.css) {
				const style = outputs.styles.obtain(input);
				style.code.set({ code: compiled.css.code, map: compiled.css.map });
			}
		}

		await Promise.all(analyses);
	}
}
