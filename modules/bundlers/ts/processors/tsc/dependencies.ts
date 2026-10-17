import type { ConditionalProcessor } from '@beyond-js/packages/sdk';
import { Compatibility } from '@beyond-js/packages/sdk';
import type { BaseConditional } from '@beyond-js/packages/module';
import type { Package } from '@beyond-js/packages/package';
import type { IWorkspaceImport } from '@beyond-js/packages/workspace';
import * as ts from 'typescript';
import { existsSync } from 'fs';
import { join } from 'path';
import { Ambient } from './ambient';

/**
 * What a package knows of the workspace it belongs to, as the declarations of its imports need it
 */
interface IResolver {
	imports?: { resolve(specifier: string, importer?: Package): IWorkspaceImport | undefined };
	resolve?(specifier: string, importer?: Package): { package: Package; subpath: string } | undefined;
}

/**
 * The declarations of the public modules of the workspace that the sources of a module import.
 *
 * They are read from the `types` conditional of each imported module, which is awaited for a bounded
 * time: two modules whose types depend on each other cannot both be first, so a dependency that does not
 * become ready in time is reported as unresolved instead of blocking the build. Each dependency is
 * subscribed to, and a change of its declaration reprocesses the processor that reads it; subscriptions
 * of dependencies a later build no longer imports are released.
 *
 * Which package of the workspace a specifier is depends on the package that imports it, so a specifier of a
 * declaration is resolved for the package that declaration belongs to. A public specifier is one ambient
 * module of the program, declared by the first instance it reaches; an alias of a member is declared under its
 * own name ([Ambient](./ambient.ts)).
 *
 * A specifier of a Kernel family (`@beyond-js/kernel/routing`) is the module of the runtime the bundler of the
 * checked module selects, as the assembly imports it ([Compatibility](../../../../sdk/conditional/esm/compatibility.ts)),
 * declared under the name the sources wrote. A module of the workspace whose bundler produces no declaration (the
 * esbuild packaging mode, which compiles the development runtime) is read from its TypeScript sources instead: the
 * program resolves its specifier to its entry point (`sources`), and its diagnostics stay its own.
 */
export class Dependencies {
	static WAIT = 8000;

	#processor: ConditionalProcessor;
	#subscriptions: Map<BaseConditional, () => void> = new Map();

	/**
	 * How the specifiers of the sources map to the modules of the runtime the module is assembled against
	 */
	get #compatibility(): Compatibility {
		const { runtime } = <{ runtime?: unknown }>(this.#processor.conditional.module.bundler?.settings ?? {});
		return new Compatibility(typeof runtime === 'string' && runtime ? runtime : void 0);
	}

	constructor(processor: ConditionalProcessor) {
		this.#processor = processor;
	}

	/**
	 * The bare specifiers the given sources import
	 */
	static specifiers(sources: string[]): Set<string> {
		const specifiers = new Set<string>();
		sources.forEach(content => {
			ts.preProcessFile(content, true, true).importedFiles.forEach(({ fileName }) => {
				!fileName.startsWith('.') && !fileName.startsWith('/') && specifiers.add(fileName);
			});
		});
		return specifiers;
	}

	/**
	 * How the workspace satisfies a specifier for a package that imports it
	 */
	#resolve(specifier: string, importer: Package): IWorkspaceImport | undefined {
		specifier = this.#compatibility.resolve(specifier);
		const workspace = <IResolver>(<unknown>importer.workspace);
		if (workspace?.imports) return workspace.imports.resolve(specifier, importer);

		const resolution = workspace?.resolve?.(specifier);
		return resolution && { specifier, name: resolution.package.name, subpath: resolution.subpath, package: resolution.package };
	}

	/**
	 * Whether a bare specifier the module imports names a public module of the workspace, declared ambiently
	 * by the program. A name the workspace holds in several packages is one too: it is never looked for on disk.
	 * Without an installed graph only: with one, the graph decides for the node that holds the importing file.
	 */
	published(specifier: string): boolean {
		const found = this.#resolve(specifier, this.#own);
		return !!found?.package || ['PACKAGE_AMBIGUOUS', 'PACKAGE_DUPLICATED'].includes(found?.error?.code);
	}

	/**
	 * The specifier a source of the module imports, as the assembly imports it: a Kernel family is the module of
	 * the runtime the bundler selects
	 */
	map(specifier: string): string {
		return this.#compatibility.resolve(specifier);
	}

	/**
	 * The entry point of a workspace module whose bundler produces no declaration, which the program reads as
	 * source, or undefined for any other specifier
	 */
	source(specifier: string, importer: Package = this.#own): string | undefined {
		const resolution = this.#resolve(specifier, importer);
		if (!resolution?.package) return;
		const { package: pkg, subpath } = resolution;
		const dependency = pkg.modules?.get(subpath);
		if (!dependency || dependency.conditionals?.get('types')) return;

		const { path, entry } = <{ path?: string; entry?: string }>dependency.spec;
		if (typeof entry !== 'string' || !/\.tsx?$/.test(entry)) return;
		const file = join(pkg.path, path ?? '', entry);
		return existsSync(file) ? file : void 0;
	}

	/**
	 * The package of the module being checked. A module types its package with an interface of its own, to
	 * avoid a circular dependency between their modules; the object is the package the workspace created.
	 */
	get #own(): Package {
		return <Package>(<unknown>this.#processor.conditional.module.package);
	}

	/**
	 * Reads the declaration of every imported public module of the workspace, and of every workspace module
	 * those declarations import in turn: a class a module extends may be declared two modules away, and the
	 * program resolves it only when that declaration is in it too.
	 *
	 * @returns The declarations by specifier, the directory of the package each one belongs to, and the
	 * specifiers that could not be read
	 */
	async read(specifiers: Set<string>): Promise<{ declarations: Map<string, string>; owners: Map<string, string>; unresolved: Map<string, string> }> {
		const declarations = new Map<string, string>();
		const owners = new Map<string, string>();
		const unresolved = new Map<string, string>();
		const wanted = new Set<BaseConditional>();
		const visited = new Set<string>();
		const ambient = new Ambient();
		const own = this.#own;
		const queue: { specifier: string; importer: Package }[] = [...specifiers].sort().map(specifier => ({ specifier, importer: own }));

		while (queue.length) {
			const { specifier, importer } = queue.shift();
			if (visited.has(specifier)) continue;
			visited.add(specifier);

			const outcome = await this.#read(specifier, importer, wanted);
			if (!outcome) continue;
			if ('reason' in outcome) {
				unresolved.set(specifier, outcome.reason);
				continue;
			}
			const { code, pkg, subpath } = outcome;
			const declared = ambient.add(specifier, code, pkg, subpath);
			if (declared) {
				declarations.set(specifier, declared);
				owners.set(specifier, pkg.path);
			}
			Dependencies.specifiers([code]).forEach(imported => !visited.has(imported) && queue.push({ specifier: imported, importer: pkg }));
		}

		[...this.#subscriptions.keys()].forEach(types => !wanted.has(types) && this.#unsubscribe(types));
		return { declarations, owners, unresolved };
	}

	/**
	 * The declaration of one workspace module, or why it cannot be read; undefined for a specifier that
	 * is not a workspace module, or the module being checked itself
	 *
	 * @param importer The package whose sources or declaration import the specifier
	 */
	async #read(specifier: string, importer: Package, wanted: Set<BaseConditional>): Promise<{ code: string; pkg: Package; subpath: string } | { reason: string } | undefined> {
		const { module } = this.#processor.conditional;
		const resolution = this.#resolve(specifier, importer);
		if (resolution?.error && ['PACKAGE_AMBIGUOUS', 'PACKAGE_DUPLICATED'].includes(resolution.error.code)) return { reason: resolution.error.message };
		if (!resolution?.package) return;

		const { package: pkg, subpath } = resolution;
		await pkg.ready;
		await pkg.modules.ready;
		const dependency = pkg.modules.get(subpath);
		if (!dependency) return { reason: `"${pkg.name}" declares no public module "${subpath}"` };
		if (dependency === module) return;

		await dependency.conditionals.ready;
		const types = dependency.conditionals.get('types');
		// Read from its sources by the program, when they are TypeScript
		if (!types) return this.source(specifier, importer) ? void 0 : { reason: `"${specifier}" produces no declaration: its bundler has no types conditional` };

		wanted.add(types);
		this.#subscribe(types);

		const timeout = new Promise<'timeout'>(resolve => setTimeout(() => resolve('timeout'), Dependencies.WAIT));
		const outcome = await Promise.race([types.ready.then(() => 'ready'), timeout]);
		if (outcome === 'timeout') return { reason: `the declaration of "${specifier}" did not become ready: its types may depend on this module` };

		const code = types.output?.code();
		if (typeof code !== 'string') {
			return { reason: `"${specifier}" has no declaration: ${types.errors.map(({ message }) => message).join('; ') || 'its types conditional produced nothing'}` };
		}
		return { code, pkg, subpath };
	}

	#subscribe(types: BaseConditional) {
		if (this.#subscriptions.has(types)) return;
		const listener = () => this.#processor._invalidate();
		types.on('change', listener);
		this.#subscriptions.set(types, listener);
	}

	#unsubscribe(types: BaseConditional) {
		const listener = this.#subscriptions.get(types);
		listener && types.off('change', listener);
		this.#subscriptions.delete(types);
	}

	destroy() {
		[...this.#subscriptions.keys()].forEach(types => this.#unsubscribe(types));
	}
}
