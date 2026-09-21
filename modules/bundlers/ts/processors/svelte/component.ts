import type { IProcessorDiagnostic } from '@beyond-js/packages/sdk';
import { Transpiler } from '@beyond-js/packages/bundlers/ts/processors/ts';

export interface ICompiledComponent {
	code?: string;
	map?: string;
	css?: { code: string; map?: string };
	diagnostics: IProcessorDiagnostic[];
	warnings: IProcessorDiagnostic[];
}

/**
 * Compiles one Svelte component into the internal module and the stylesheet of its module, with the
 * pinned Svelte 5 compiler this package installs.
 *
 * The component is compiled for the client on browser platforms and for the server on Node, with its CSS
 * kept external, so the stylesheet of the module holds it like any other style output. TypeScript in
 * `<script lang="ts">` is handled by the Svelte compiler itself. The JavaScript it emits is an ES module
 * that imports `svelte/internal/*`, which the transpiler turns into the CommonJS shape of an internal
 * module; `svelte` is therefore a public dependency of the module. Positions of the errors are those of
 * the `.svelte` file.
 */
export class Component {
	#file: string;
	#relative: string;
	#platform: string;

	constructor(file: string, relative: string, platform: string) {
		this.#file = file;
		this.#relative = relative;
		this.#platform = platform;
	}

	#position(diagnostic: any) {
		const start = diagnostic?.start ?? diagnostic?.position?.start;
		return start && typeof start.line === 'number' ? { line: start.line, column: (start.column ?? 0) + 1 } : void 0;
	}

	async compile(content: string): Promise<ICompiledComponent> {
		const diagnostics: IProcessorDiagnostic[] = [];
		const warnings: IProcessorDiagnostic[] = [];

		const svelte = await import('svelte/compiler');
		let result;
		try {
			result = svelte.compile(content, {
				filename: this.#file,
				generate: this.#platform === 'node' ? 'server' : 'client',
				css: 'external',
				dev: false
			});
		} catch (error) {
			return { diagnostics: [{ code: 'SVELTE_ERROR', message: error.message, position: this.#position(error) }], warnings };
		}

		result.warnings.forEach(warning => warnings.push({ code: 'SVELTE_WARNING', message: warning.message, position: this.#position(warning) }));

		// The compiler emits an ES module: it becomes an internal module through the same transformation as a source
		const transpiled = Transpiler.transform({ file: this.#relative, content: result.js.code, kind: 'js' });
		transpiled.diagnostics.forEach(diagnostic => diagnostics.push({ ...diagnostic, code: 'SVELTE_ERROR' }));
		if (diagnostics.length) return { diagnostics, warnings };

		const css = result.css?.code ? { code: result.css.code, map: result.css.map && JSON.stringify(result.css.map) } : void 0;
		return { code: transpiled.code, map: transpiled.map, css, diagnostics, warnings };
	}
}
