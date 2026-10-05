import type { IDiagnostic } from '@beyond-js/packages/types';
import type { Package } from '@beyond-js/packages/package';
import type { Workspace } from './index';
import { Selector } from './selector';
import { resolve, relative, isAbsolute, sep } from 'path';

/**
 * The public module that a selector addresses in a workspace
 */
export /*bundle*/ interface ISelected {
	package: Package;
	subpath: string;

	/**
	 * The public specifier of the module, such as `@example/app/main`, which is what a consumer imports
	 */
	specifier: string;

	/**
	 * The versioned identity of the module, such as `@example/app@1.0.0/main`
	 */
	vspecifier: string;

	/**
	 * The output the selector names: `js` unless an explicit `.css` selects the stylesheet of the module
	 */
	output: 'js' | 'css';
}

/**
 * Resolves selectors against the packages of a workspace.
 *
 * It is the one place where a command or a client request becomes a public module, so every caller gets
 * the same answers: one name and version at two directories is rejected with both locations, a name held
 * in several versions needs the selector to name the version of the instance it selects, an exact version
 * must match, a local selector needs a package that contains the directory it is resolved from, and nothing
 * is guessed from source files or from a coincidentally unique module name.
 */
export /*bundle*/ class Selection {
	#workspace: Workspace;

	constructor(workspace: Workspace) {
		this.#workspace = workspace;
	}

	/**
	 * The packages of the workspace, once each of them has read its manifest
	 */
	async #packages(): Promise<[string, Package][]> {
		await this.#workspace.ready;
		const packages = [...this.#workspace.packages];
		await Promise.all(packages.map(([, pkg]) => pkg.ready));
		return packages;
	}

	/**
	 * The name and version pairs declared by more than one package of the workspace. Several versions of a
	 * name are instances, which a versioned selector or the installed graph tells apart; one version at two
	 * directories cannot be told apart, and either would silently take or lose its public specifiers.
	 */
	async duplicates(): Promise<IDiagnostic[]> {
		const locations = new Map<string, string[]>();
		(await this.#packages()).forEach(([location, pkg]) => {
			if (!pkg.valid || !pkg.name) return;
			locations.set(pkg.vname, (locations.get(pkg.vname) ?? []).concat(location));
		});

		return [...locations]
			.filter(([, found]) => found.length > 1)
			.map(([vname, found]) => ({
				code: 'PACKAGE_DUPLICATED',
				message: `Package "${vname}" is declared by more than one workspace package: ${found.join(', ')}`
			}));
	}

	/**
	 * The package that contains a directory, which is the current package of a command invoked there
	 */
	async current(directory: string): Promise<Package | undefined> {
		let found: Package;
		(await this.#packages()).forEach(([, pkg]) => {
			const inside = relative(resolve(pkg.path), resolve(directory));
			if (inside.startsWith('..') || isAbsolute(inside)) return;

			// A package nested in the directory of another one is the more specific context
			if (!found || resolve(pkg.path).split(sep).length > resolve(found.path).split(sep).length) found = pkg;
		});
		return found;
	}

	/**
	 * Resolves a selector to a declared public module
	 *
	 * @param input The selector, as documented by Selector
	 * @param directory Where a local selector (`.`, `./module`) is resolved from
	 */
	async resolve(input: string, directory?: string): Promise<{ selected?: ISelected; errors: IDiagnostic[] }> {
		const fail = (code: string, message: string) => ({ errors: [{ code, message }] });

		const selector = new Selector(input);
		if (!selector.valid) return { errors: [selector.error] };

		const duplicates = await this.duplicates();
		if (duplicates.length) return { errors: duplicates };

		const packages = (await this.#packages()).filter(([, pkg]) => pkg.valid);
		const names = [...new Set(packages.map(([, pkg]) => pkg.name))].join(', ') || 'none';

		let pkg: Package;
		if (selector.local) {
			pkg = directory && (await this.current(directory));
			if (!pkg) {
				const message =
					`"${input}" names a module of the current package, but "${directory}" is not inside a package ` +
					`of the workspace. Name the package, for example <package>/${selector.subpath.replace(/^\.\/?/, '')} ` +
					`(packages: ${names})`;
				return fail('SELECTOR_PACKAGE_REQUIRED', message);
			}
		} else {
			const instances = packages.filter(([, one]) => one.name === selector.name);
			if (!instances.length) return fail('PACKAGE_NOT_FOUND', `Package "${selector.name}" is not in the workspace (packages: ${names})`);

			const chosen = this.#instance(selector, instances);
			if (chosen.error) return { errors: [chosen.error] };
			pkg = chosen.package;
		}

		await pkg.modules.ready;
		const found = this.#output(pkg, selector);
		if (found.error) return { errors: [found.error] };
		const { subpath, output } = found;

		const path = subpath === '.' ? '' : `/${subpath.slice(2)}`;
		return { selected: { package: pkg, subpath, specifier: pkg.name + path, vspecifier: pkg.vname + path, output }, errors: [] };
	}

	/**
	 * The instance of a package name that a selector selects: the one of its version, or the only one. An
	 * unversioned selector of a name held in several versions is ambiguous, and nothing is guessed.
	 *
	 * @param instances The packages of the workspace that hold the name, with their keys
	 */
	#instance(selector: Selector, instances: [string, Package][]): { package?: Package; error?: IDiagnostic } {
		const { input, name, version } = selector;
		const path = selector.subpath === '.' ? '' : `/${selector.subpath.slice(2)}`;

		if (version) {
			const found = instances.find(([, one]) => one.version === version);
			if (found) return { package: found[1] };

			const held = instances.map(([, one]) => one.vname).join(', ');
			const which = instances.length === 1 ? `the workspace package is ${held}` : `the workspace packages are ${held}`;
			return { error: { code: 'VERSION_MISMATCH', message: `"${input}" requires ${name}@${version}, but ${which}` } };
		}
		if (instances.length === 1) return { package: instances[0][1] };

		const versions = instances.map(([key, one]) => `${one.version} (${key})`).join(', ');
		const message =
			`"${input}" names "${name}", which the workspace provides in more than one version: ${versions}. ` +
			`Name the version of the one to select, such as ${name}@${instances[0][1].version}${path}`;
		return { error: { code: 'PACKAGE_AMBIGUOUS', message } };
	}

	/**
	 * The module and the output a selector names. An explicit `.css` selects the stylesheet of the module
	 * named without it, unless the package declares that literal subpath; `.js` and `.mjs` state the code the
	 * same way. Two different modules for one selector are ambiguous, and nothing is guessed.
	 */
	#output(pkg: Package, selector: Selector): { subpath?: string; output?: 'js' | 'css'; error?: IDiagnostic } {
		const { subpath } = selector;
		const extension = subpath === '.' ? void 0 : /\.(css|js|mjs)$/.exec(subpath)?.[1];
		const output = extension === 'css' ? 'css' : 'js';
		if (!extension) return pkg.modules.has(subpath) ? { subpath, output } : { error: this.#missing(pkg, selector) };

		const stripped = subpath.slice(0, -(extension.length + 1));
		const literal = pkg.modules.has(subpath) ? subpath : void 0;
		const other = stripped.length > 2 && !stripped.endsWith('/') && pkg.modules.has(stripped) ? stripped : void 0;
		if (literal && other) {
			const message = `"${selector.input}" is ambiguous: package "${pkg.name}" declares both "${literal}" and "${other}", whose ${output === 'css' ? 'stylesheet' : 'code'} it would also select`;
			return { error: { code: 'OUTPUT_AMBIGUOUS', message } };
		}

		const selected = literal ?? other;
		if (!selected) return { error: this.#missing(pkg, selector) };
		const values = <{ kind?: string }>pkg.modules.specs?.get(selected)?.values;
		if (output === 'js' && values?.kind === 'style') {
			const message = `"${selector.input}" selects code, and "${selected}" of "${pkg.name}" is a stylesheet: select it with ".css"`;
			return { error: { code: 'OUTPUT_NOT_FOUND', message } };
		}
		return { subpath: selected, output };
	}

	/**
	 * Why a package does not publish the selected module, with what it does publish and the diagnostics
	 * that explain a module that was declared but could not be resolved
	 */
	#missing(pkg: Package, selector: Selector): IDiagnostic {
		const { subpath } = selector;
		const declared = [...pkg.modules.keys()].join(', ') || 'none';
		const what = subpath === '.' ? 'a root public module' : `the public module "${subpath}"`;

		const hints = pkg.modules.errors
			.concat(pkg.modules.warnings)
			.map(({ message }) => message);
		!selector.local && subpath === '.' && pkg.modules.has(`./${pkg.name}`) && hints.push(`Did you mean ./${pkg.name}?`);

		const message =
			`Package "${pkg.name}" does not declare ${what} (declared: ${declared})` +
			(hints.length ? `. ${hints.join('. ')}` : '');
		return { code: 'MODULE_NOT_FOUND', message };
	}
}
