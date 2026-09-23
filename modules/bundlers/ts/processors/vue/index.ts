import type { Conditional, ProcessorOutputs } from '@beyond-js/packages/sdk';
import type { IRequest } from '@beyond-js/dynamic-processor/main';
import { ConditionalProcessor, ProcessorOutput, Scope } from '@beyond-js/packages/sdk';
import { Analyzer } from '@beyond-js/packages/bundlers/ts/processors/ts';
import { FileData } from '@beyond-js/file/data';
import { DynamicFile } from '@beyond-js/file/dynamic';
import { join } from 'path';
import { Component } from './component';

/**
 * Compiles the `.vue` single-file components of a public module into internal modules and stylesheets.
 *
 * A component `view.vue` yields three internal modules, `./view.script`, `./view.render` and `./view`,
 * the last being what `require('./view.vue')` and `import View from './view.vue'` resolve to; and one
 * style output per `<style>` block. The script and the template are compiled by the Vue compiler this
 * package pins; TypeScript in `<script lang="ts">` is transpiled like any source of the module. The Vue
 * runtime is a public dependency of the module, bare as any other.
 */
export /*bundle*/ class Processor extends ConditionalProcessor {
	constructor(conditional: Conditional, name: string) {
		super(conditional, name, { sources: { inputs: { extname: ['.vue'] } } });
	}

	/**
	 * The output of a generated file that has no source of its own: it is registered under the name of
	 * the generated file, beside the component
	 */
	#generated(input: DynamicFile, file: string): ProcessorOutput {
		const { module } = this.conditional;
		const root = join(module.package.path, module.spec.path ?? '');
		const data = new FileData(root, join(root, file));
		return new ProcessorOutput(<DynamicFile>(<unknown>{ relative: data.relative, file: data.file, hash: input.hash }));
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
			const scope = `data-v-${new Scope(this.conditional, input.file).hash(8)}`;
			const compiled = await new Component(input.file, relative, platform, scope).compile(input.content);
			if (request !== this._request) return;

			compiled.diagnostics.forEach(diagnostic => output.issues.push('errors', diagnostic));
			compiled.warnings.forEach(warning => output.issues.push('warnings', warning));
			if (compiled.diagnostics.length) continue;

			for (const generated of compiled.modules) {
				const target = generated.file === relative ? output : this.#generated(input, generated.file);
				target.code.set({ code: generated.code, map: generated.map });
				generated.file !== relative && outputs.ims.update(target);
				analyses.push(Analyzer.process(target));
			}

			compiled.styles.forEach((style, index) => {
				const target = index === 0 ? outputs.styles.obtain(input) : this.#generated(input, `${relative}.${index}.css`);
				target.code.set({ code: style.code, map: style.map });
				index && outputs.styles.update(target);
			});
		}

		await Promise.all(analyses);
	}
}
