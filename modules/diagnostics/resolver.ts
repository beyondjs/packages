import type { IDependenciesInput, IDiagnosticsConditions, IModuleInput } from './types';
import type { Files } from './files';
import { Paths } from './paths';
import { Exports } from './exports';
import * as ts from 'typescript';

/**
 * Finds the types of what the sources of a module import.
 *
 * A relative import is left to the compiler. A bare specifier is a public dependency: its types come from
 * the declaration its caller supplied for the specifier, from the directory supplied for its package, from
 * a `node_modules`-like root, from the package being checked when it imports its own specifier, and last
 * from the resolution of the compiler, which reads the `node_modules` of the package. A specifier nothing
 * types stays unresolved, which the compiler reports once and types as `any`; it is not an error of the
 * module.
 */
export class Resolver {
	#module: IModuleInput;
	#paths: Paths;
	#files: Files;
	#exports: Exports;

	#declarations: Map<string, string> = new Map();
	#packages: Map<string, string> = new Map();
	#roots: string[] = [];

	/**
	 * The `node_modules`-like directories where packages of types are looked up
	 */
	get roots(): string[] {
		return [`${this.#paths.root}/node_modules`, ...this.#roots];
	}

	/**
	 * The packages of global types the caller supplied by directory, such as `@types/node`
	 */
	get ambient(): string[] {
		return [...this.#packages.keys()].filter(name => name.startsWith('@types/')).map(name => name.slice(7));
	}

	constructor(
		module: IModuleInput,
		paths: Paths,
		files: Files,
		conditions: IDiagnosticsConditions,
		input?: IDependenciesInput
	) {
		this.#module = module;
		this.#paths = paths;
		this.#files = files;

		const { platform, environment } = conditions;
		const selected = [platform === 'web' ? 'browser' : platform, environment].filter(Boolean);
		this.#exports = new Exports(files, <string[]>selected);

		// Only absolute locations are usable; anything else is ignored instead of being resolved from the host
		const usable = (values: unknown): [string, string][] =>
			Object.entries(values && typeof values === 'object' ? values : {}).filter(([, value]) =>
				Paths.absolute(value)
			);

		usable(input?.declarations).forEach(([specifier, file]) => {
			const normalized = Paths.normalize(file);
			this.#declarations.set(specifier, normalized);
			paths.allow(normalized, `<declarations>/${specifier}`);
		});
		usable(input?.packages).forEach(([name, directory]) => {
			const normalized = Paths.normalize(directory);
			this.#packages.set(name, normalized);
			paths.allow(normalized, `<dependencies>/${name}`);
		});
		(Array.isArray(input?.roots) ? input.roots : []).filter(Paths.absolute).forEach(root => {
			const normalized = Paths.normalize(root);
			this.#roots.push(normalized);
			paths.allow(normalized, '<dependencies>');
		});
	}

	/**
	 * Splits a bare specifier into the name of its package and the subpath it requests
	 */
	static split(specifier: string): { name: string; subpath: string } {
		const parts = specifier.split('/');
		const name = parts.splice(0, specifier.startsWith('@') ? 2 : 1).join('/');
		return { name, subpath: parts.length ? `./${parts.join('/')}` : '.' };
	}

	/**
	 * The directory of a package, where the caller or the package being checked provides it
	 */
	#directory(name: string): string | undefined {
		if (this.#packages.has(name)) return this.#packages.get(name);
		if (name === this.#module.package) return this.#paths.root;
		return this.roots
			.map(root => `${root}/${name}`)
			.find(directory => this.#files.exists(`${directory}/package.json`));
	}

	/**
	 * The file that types a bare specifier, or undefined when nothing the check may read does
	 */
	#bare(specifier: string): string | undefined {
		if (this.#declarations.has(specifier)) {
			const file = this.#declarations.get(specifier);
			return this.#files.exists(file) ? file : void 0;
		}

		const { name, subpath } = Resolver.split(specifier);
		const directory = this.#directory(name);
		const typed = directory && this.#exports.types(directory, subpath);
		if (typed || name.startsWith('@types/')) return typed;

		// A package without types of its own is typed by its `@types` counterpart
		const types = this.#directory(`@types/${name.replace(/^@/, '').replace('/', '__')}`);
		return types && this.#exports.types(types, subpath);
	}

	/**
	 * Resolves one import of a source
	 *
	 * @param specifier The specifier as written
	 * @param containing The absolute file that imports it
	 */
	module(
		specifier: string,
		containing: string,
		options: ts.CompilerOptions,
		host: ts.ModuleResolutionHost
	): ts.ResolvedModuleFull | undefined {
		const relative = specifier.startsWith('.') || specifier.startsWith('/');
		const file = relative ? void 0 : this.#bare(specifier);
		if (!file) return ts.resolveModuleName(specifier, containing, options, host).resolvedModule;

		const extension = [
			ts.Extension.Dts,
			ts.Extension.Dmts,
			ts.Extension.Dcts,
			ts.Extension.Tsx,
			ts.Extension.Mts,
			ts.Extension.Cts
		];
		return {
			resolvedFileName: file,
			extension: extension.find(one => file.endsWith(one)) ?? ts.Extension.Ts,

			// A dependency is never a source of the module: it is read for its types and not reported
			isExternalLibraryImport: this.#paths.relative(file) === void 0
		};
	}

	/**
	 * The file of a package of global types, requested by the `types` option or by a reference directive
	 */
	types(name: string): string | undefined {
		const specifier = name.startsWith('@types/') ? name : `@types/${name}`;
		const directory = this.#directory(specifier);
		return directory && this.#exports.types(directory, '.');
	}
}
