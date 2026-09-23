import type { IDiagnostic } from '@beyond-js/packages/types';
import type { Package } from '@beyond-js/packages/package';
import type { IBundled } from '@beyond-js/packages/bundlers/esbuild/processors/bundle';
import { Conditions } from '@beyond-js/packages/module';
import type { IAnalysisConditions } from '../types';
import { basename, isAbsolute, relative, sep } from 'path';

/**
 * One public module of a pinned package compiled by the bundler the package declares.
 *
 * A Beyond package declares how its modules are compiled: which bundler assembles them, which processors
 * read their sources (stylesheets, framework components, declarations) and which runtime the composed
 * artifact is written against. Preparing such a package with another compiler produces something the
 * package never described — a widget that registers no element, a source no loader accepts, no stylesheet —
 * so the declared bundler is what runs here.
 *
 * The result has the shape the rest of the analysis and the generation already read, so a composed module
 * is traced, keyed, generated and delivered exactly like a packaged one. Nothing of another package is
 * inlined: a pinned package resolves no sibling by itself, so every public reference of the artifact stays
 * bare and the graph says which node satisfies it.
 */
export /*bundle*/ class Composition {
	/**
	 * The bundler of the packaging mode. A module that selects it is compiled by the selected compiler and
	 * is not composed here.
	 */
	static PACKAGING = '@beyond-js/packages/bundlers/esbuild';

	/**
	 * The bundler a public module of a package is composed by, when it is composed by one of its own
	 *
	 * @param pkg The package as Packages reads it
	 * @param subpath The public subpath, as the package declares it
	 */
	static declared(pkg: Package, subpath: string): { name: string; specifier: string } | undefined {
		const spec = (<{ specs?: Map<string, { bundler?: string }> }>(<unknown>pkg.modules))?.specs?.get(subpath);
		const name = spec?.bundler;
		if (!name || name === 'exports') return;

		const specifier = (<{ get(name: string): { specifier?: string } | undefined }>(<unknown>pkg.bundlers))?.get(name)?.specifier;
		if (!specifier || specifier === Composition.PACKAGING) return;
		return { name, specifier };
	}

	#pkg: Package;
	#subpath: string;
	#conditions: IAnalysisConditions;

	constructor(pkg: Package, subpath: string, conditions: IAnalysisConditions) {
		this.#pkg = pkg;
		this.#subpath = subpath;
		this.#conditions = conditions;
	}

	/**
	 * The conditions as the conditionals of a module name them: Packages calls a browser `web`
	 */
	get #requested(): Conditions {
		const { platform, environment } = this.#conditions;
		return new Conditions({ platform: platform === 'browser' ? 'web' : platform, environment });
	}

	/**
	 * Compiles the module with its bundler and answers what a bundled module answers
	 */
	async run(): Promise<{ bundled?: IBundled; diagnostics: IDiagnostic[] }> {
		const diagnostics: IDiagnostic[] = [];
		const fail = (code: string, message: string) => (diagnostics.push({ code, message }), { diagnostics });

		const specifier = this.#subpath === '.' ? this.#pkg.name : `${this.#pkg.name}/${this.#subpath.replace(/^\.\//, '')}`;
		const module = this.#pkg.modules.get(this.#subpath);
		if (!module) return fail('MODULE_NOT_FOUND', `Package "${this.#pkg.name}" does not publish "${specifier}"`);

		await module.conditionals.ready;
		const requested = this.#requested;
		const key = requested.select(module);
		if (!key) {
			const declared = [...module.conditionals.keys()].filter(one => one !== 'types' && !one.includes('/')).join(', ');
			return fail('PLATFORM_UNSUPPORTED', `Module "${specifier}" does not produce the "${requested.key}" conditional (declared: ${declared})`);
		}

		const conditional = <Record<string, any>>(<unknown>module.conditionals.get(key));
		await conditional.ready;
		if (!conditional.valid || !conditional.output) {
			const errors = <(IDiagnostic & { file?: string })[]>(conditional.errors ?? []);
			errors.forEach(error => diagnostics.push({ ...error, ...this.#located(error.file), message: `Module "${specifier}": ${error.message}` }));
			!errors.length && diagnostics.push({ code: 'BUNDLE_ERROR', message: `Module "${specifier}" did not produce its output` });
			return { diagnostics };
		}

		return { bundled: this.#bundled(conditional, key), diagnostics };
	}

	/**
	 * The file a diagnostic names, as a path in the package: where the package was extracted is a fact of
	 * the machine that compiled it, and a diagnostic is returned to whoever prepared the package
	 */
	#located(file?: string): { file?: string } {
		if (typeof file !== 'string' || !isAbsolute(file)) return {};
		const path = relative(this.#pkg.path, file);
		return { file: path && !path.startsWith('..') && !isAbsolute(path) ? path.split(sep).join('/') : basename(file) };
	}

	/**
	 * The composed conditional in the shape of a bundled module
	 */
	#bundled(conditional: Record<string, any>, key: string): IBundled {
		const { output, styles, artifact } = conditional;

		// The runtime is a public module like any other reference: the graph says which node supplies it
		const specifiers: string[] = [...new Set<string>([...(artifact?.dependencies ?? []), artifact?.runtime].filter(Boolean))];
		const references = specifiers.map(specifier => ({ specifier, kind: <const>'eager' }));

		return <IBundled>(<unknown>{
			code: output.code('raw-code'),
			map: <string>output.map('string'),
			css: styles ? styles.code('raw-code') : void 0,
			cssmap: styles ? <string>styles.map('string') : void 0,
			exports: <string[]>(artifact?.exports ?? []),
			stars: [],
			dependencies: specifiers,
			references,
			indeterminate: [],
			resources: [],
			inputs: this.#inputs(conditional),
			configuration: { conditional: key, widget: !!artifact?.widget, runtime: artifact?.runtime }
		});
	}

	/**
	 * The source files the compilation read, which the provenance of an output names
	 */
	#inputs(conditional: Record<string, any>): string[] {
		const files: Set<string> = new Set();
		type Collection = { forEach?(callback: (item: { file?: unknown }) => void): void };
		const processors = <Map<string, { dependencies?: string[]; sources?: { inputs?: Collection; files?: Collection } }>>conditional.processors;

		// The sources of a processor are its inputs and the files it reads beside them; the dependencies are
		// what its compiler read on its own, such as the partials of a stylesheet
		const add = (file: unknown) => typeof file === 'string' && files.add(file);
		processors?.forEach?.(processor => {
			processor.dependencies?.forEach(add);
			processor.sources?.inputs?.forEach?.(input => add(input?.file));
			processor.sources?.files?.forEach?.(input => add(input?.file));
		});
		return [...files].sort();
	}
}
