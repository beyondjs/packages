import type { IProcessorDiagnostic } from '@beyond-js/packages/sdk';
import { Transpiler } from '@beyond-js/packages/bundlers/ts/processors/ts';

/**
 * One internal module produced from a single-file component
 */
export interface IComponentModule {
	/**
	 * The file the internal module is registered for, relative to the module directory: the component
	 * itself and the generated `.script` and `.render` files beside it
	 */
	file: string;
	code: string;
	map?: string;
}

export interface ICompiledComponent {
	modules: IComponentModule[];
	styles: { code: string; map?: string }[];
	diagnostics: IProcessorDiagnostic[];
	warnings: IProcessorDiagnostic[];
}

/**
 * Compiles one Vue single-file component into the internal modules and the stylesheets of its module,
 * with the pinned Vue compiler this package installs.
 *
 * The script, `<script>` and `<script setup>` together, is compiled by the SFC compiler into one TypeScript
 * source and transpiled into the `.script` internal module; the template is compiled with the binding
 * metadata of that script into the `.render` internal module; the component itself is a facade that joins
 * them and names its file and scope id. Every `<style>` block, scoped or not, is compiled into one style
 * output, in order. Positions of the errors the compiler reports are those of the `.vue` file.
 */
export class Component {
	#file: string;
	#relative: string;
	#platform: string;

	/**
	 * @param file The absolute path of the component
	 * @param relative Its path relative to the module directory, with forward slashes
	 * @param platform The platform of the conditional: the server render function is generated for `node`
	 */
	constructor(file: string, relative: string, platform: string) {
		this.#file = file;
		this.#relative = relative;
		this.#platform = platform;
	}

	/**
	 * The relative path of the component without its extension, which names its generated files
	 */
	get #base(): string {
		return this.#relative.replace(/\.vue$/, '');
	}

	/**
	 * How the facade requires its generated siblings: relative to the component itself, because the runtime
	 * resolves a relative require from the directory of the internal module that requires. An earlier
	 * version named them from the module directory, which located nothing for a component in a
	 * subdirectory.
	 */
	get #sibling(): string {
		return `./${this.#base.split('/').pop()}`;
	}

	/**
	 * The scope id of the component, derived from its file so that it is stable across builds
	 */
	get #scope(): string {
		let hash = 0x811c9dc5;
		for (let i = 0; i < this.#relative.length; i++) hash = Math.imul(hash ^ this.#relative.charCodeAt(i), 0x01000193) >>> 0;
		return `data-v-${hash.toString(16).padStart(8, '0')}`;
	}

	/**
	 * A 32-bit FNV-1a of the component source
	 */
	static #hash(content: string): string {
		let hash = 0x811c9dc5;
		for (let i = 0; i < content.length; i++) hash = Math.imul(hash ^ content.charCodeAt(i), 0x01000193) >>> 0;
		return hash.toString(16).padStart(8, '0');
	}

	#position(error: any, block?: { loc?: { start?: { line: number; column: number } } }) {
		const loc = error?.loc?.start ?? block?.loc?.start;
		return loc ? { line: loc.line, column: loc.column } : void 0;
	}

	async compile(content: string): Promise<ICompiledComponent> {
		const diagnostics: IProcessorDiagnostic[] = [];
		const warnings: IProcessorDiagnostic[] = [];
		const modules: IComponentModule[] = [];
		const styles: ICompiledComponent['styles'] = [];

		const sfc = await import('vue/compiler-sfc');
		const scope = this.#scope;
		const { descriptor, errors } = sfc.parse(content, { filename: this.#file, sourceMap: true });
		errors.forEach(error => diagnostics.push({ code: 'VUE_PARSE_ERROR', message: error.message, position: this.#position(error) }));
		if (diagnostics.length) return { modules, styles, diagnostics, warnings };

		// 1. The script: both blocks compiled into one, whose default export is the component options
		let bindings;
		const scriptId = `${this.#sibling}.script`;
		if (descriptor.script || descriptor.scriptSetup) {
			let compiled;
			try {
				compiled = sfc.compileScript(descriptor, { id: scope, inlineTemplate: false, sourceMap: true, genDefaultAs: '__component' });
			} catch (error) {
				diagnostics.push({ code: 'VUE_SCRIPT_ERROR', message: error.message, position: this.#position(error, descriptor.scriptSetup ?? descriptor.script) });
				return { modules, styles, diagnostics, warnings };
			}
			bindings = compiled.bindings;
			(compiled.warnings ?? []).forEach(message => warnings.push({ code: 'VUE_SCRIPT_WARNING', message }));

			const kind = (descriptor.scriptSetup ?? descriptor.script)?.lang === 'ts' ? 'ts' : 'js';
			const source = `${compiled.content}\nexport default __component;\n`;
			const transpiled = Transpiler.transform({ file: `${this.#base}.script.${kind}`, content: source, kind });
			transpiled.diagnostics.forEach(diagnostic => diagnostics.push({ ...diagnostic, code: 'VUE_SCRIPT_ERROR' }));
			if (diagnostics.length) return { modules, styles, diagnostics, warnings };
			modules.push({ file: `${this.#base}.script.js`, code: transpiled.code, map: transpiled.map });
		} else {
			modules.push({ file: `${this.#base}.script.js`, code: 'exports.default = {};\n' });
		}

		// 2. The template, compiled with the bindings of the script; the server variant renders to a string
		const renderId = `${this.#sibling}.render`;
		if (descriptor.template) {
			const ssr = this.#platform === 'node';
			const scoped = descriptor.styles.some(style => style.scoped);
			const template = sfc.compileTemplate({
				source: descriptor.template.content,
				filename: this.#file,
				id: scope,
				scoped,
				ssr,
				ssrCssVars: descriptor.cssVars,
				compilerOptions: { bindingMetadata: bindings, sourceMap: true },
				inMap: descriptor.template.map
			});
			template.errors.forEach(error => diagnostics.push({ code: 'VUE_TEMPLATE_ERROR', message: typeof error === 'string' ? error : error.message, position: this.#position(error, descriptor.template) }));
			template.tips.forEach(tip => warnings.push({ code: 'VUE_TEMPLATE_TIP', message: tip }));
			if (diagnostics.length) return { modules, styles, diagnostics, warnings };

			const transpiled = Transpiler.transform({ file: `${this.#base}.render.js`, content: template.code, kind: 'js' });
			transpiled.diagnostics.forEach(diagnostic => diagnostics.push({ ...diagnostic, code: 'VUE_TEMPLATE_ERROR' }));
			if (diagnostics.length) return { modules, styles, diagnostics, warnings };
			modules.push({ file: `${this.#base}.render.js`, code: transpiled.code, map: transpiled.map });
		}

		// 3. The facade: the component as the module imports it. It carries the hash of the component source,
		// so that any edit of the component evaluates the facade again and the module that imports the
		// component receives a new object: an unchanged facade would keep the render function it joined
		// when it was evaluated, and an update of the template alone would not reach the mounted view.
		const facade = [
			`// ${Component.#hash(content)}`,
			`const component = require('${scriptId}').default;`,
			descriptor.template ? `const { ${this.#platform === 'node' ? 'ssrRender' : 'render'} } = require('${renderId}');` : '',
			descriptor.template ? (this.#platform === 'node' ? 'component.ssrRender = ssrRender;' : 'component.render = render;') : '',
			`component.__file = ${JSON.stringify(this.#relative)};`,
			descriptor.styles.some(style => style.scoped) ? `component.__scopeId = ${JSON.stringify(scope)};` : '',
			descriptor.cssVars?.length ? `component.__cssModules = component.__cssModules;` : '',
			'exports.default = component;',
			''
		].filter(line => line !== '').join('\n');
		modules.push({ file: this.#relative, code: facade });

		// 4. The styles, one output per block, in order
		descriptor.styles.forEach((style, index) => {
			if (style.lang && style.lang !== 'css') {
				diagnostics.push({ code: 'VUE_STYLE_UNSUPPORTED', message: `The style language "${style.lang}" of block ${index + 1} is not supported: use CSS in a component and SCSS in a module stylesheet`, position: this.#position(void 0, style) });
				return;
			}
			const compiled = sfc.compileStyle({ source: style.content, filename: this.#file, id: scope, scoped: !!style.scoped, map: style.map });
			compiled.errors.forEach(error => diagnostics.push({ code: 'VUE_STYLE_ERROR', message: error.message, position: this.#position(error, style) }));
			compiled.errors.length || styles.push({ code: compiled.code, map: compiled.map && JSON.stringify(compiled.map) });
		});

		return { modules, styles, diagnostics, warnings };
	}
}
