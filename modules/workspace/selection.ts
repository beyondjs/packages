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
}

/**
 * Resolves selectors against the packages of a workspace.
 *
 * It is the one place where a command or a client request becomes a public module, so every caller gets
 * the same answers: a name held by two packages is rejected with both locations, an exact version must
 * match, a local selector needs a package that contains the directory it is resolved from, and nothing
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
	 * The names declared by more than one package of the workspace. One package of each name is the
	 * supported boundary: a second one would silently take or lose every public specifier of that name.
	 */
	async duplicates(): Promise<IDiagnostic[]> {
		const locations = new Map<string, string[]>();
		(await this.#packages()).forEach(([location, pkg]) => {
			if (!pkg.valid || !pkg.name) return;
			locations.set(pkg.name, (locations.get(pkg.name) ?? []).concat(location));
		});

		return [...locations]
			.filter(([, found]) => found.length > 1)
			.map(([name, found]) => ({
				code: 'PACKAGE_DUPLICATED',
				message: `Package "${name}" is declared by more than one workspace package: ${found.join(', ')}`
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

		const packages = (await this.#packages()).map(([, pkg]) => pkg).filter(pkg => pkg.valid);
		const names = packages.map(pkg => pkg.name).join(', ') || 'none';

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
			pkg = packages.find(({ name }) => name === selector.name);
			if (!pkg) return fail('PACKAGE_NOT_FOUND', `Package "${selector.name}" is not in the workspace (packages: ${names})`);
		}

		if (selector.version && selector.version !== pkg.version) {
			const message = `"${input}" requires ${pkg.name}@${selector.version}, but the workspace package is ${pkg.vname}`;
			return fail('VERSION_MISMATCH', message);
		}

		await pkg.modules.ready;
		const { subpath } = selector;
		if (!pkg.modules.has(subpath)) return { errors: [this.#missing(pkg, selector)] };

		const path = subpath === '.' ? '' : `/${subpath.slice(2)}`;
		return { selected: { package: pkg, subpath, specifier: pkg.name + path, vspecifier: pkg.vname + path }, errors: [] };
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
