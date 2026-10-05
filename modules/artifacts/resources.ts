import { type Selection, type Workspace } from '@beyond-js/packages/workspace';
import type { IDiagnostic, IConditions } from '@beyond-js/packages/types';
import type { ConditionalOutput } from '@beyond-js/packages/module/output';
import { promises as fs } from 'fs';
import { join, posix } from 'path';
import { Conditions } from '@beyond-js/packages/module';
import { Compilation } from './compilation';
import type { Dependencies } from './dependencies';
import type { Installed } from './installed';

/**
 * Why a companion resource cannot be delivered. `OUTPUT_NOT_AVAILABLE` means that the module or the package
 * is known and has no such output: a module without a stylesheet, a file the package does not declare.
 */
export /*bundle*/ interface IResourceFailure {
	code: 'PACKAGE_NOT_FOUND' | 'VERSION_MISMATCH' | 'MODULE_NOT_FOUND' | 'BUILD_FAILED' | 'OUTPUT_NOT_AVAILABLE';
	message: string;
	diagnostics?: IDiagnostic[];
}

/**
 * The companion resources of the public modules of a workspace: the stylesheet a module produces next to
 * its code, and the static files its package declares.
 *
 * A stylesheet exists for a module whose bundler produces one, which today is the esbuild packaging mode
 * when the sources import CSS. A static file is delivered when a module manifest (`assets`, relative to the
 * module directory) or the package manifest (`beyond.assets`, relative to the package) declares it, so a
 * request can never read an arbitrary file of the package.
 */
export /*bundle*/ class Resources {
	#workspace: Workspace;
	#selection: Selection;
	#dependencies: Dependencies;

	#installed: Installed;

	constructor(workspace: Workspace, selection: Selection, dependencies: Dependencies, installed?: Installed) {
		this.#workspace = workspace;
		this.#selection = selection;
		this.#dependencies = dependencies;
		this.#installed = installed;
	}

	#failure(errors: IDiagnostic[]): IResourceFailure {
		const [{ code, message }] = errors;
		const known = ['PACKAGE_NOT_FOUND', 'VERSION_MISMATCH', 'MODULE_NOT_FOUND'].includes(code);
		return { code: known ? <IResourceFailure['code']>code : 'BUILD_FAILED', message, diagnostics: errors };
	}

	/**
	 * The current stylesheet of a module, compiled on request like its code
	 */
	async styles(request: { name: string; version: string; subpath: string }, conditions: IConditions): Promise<{ styles?: ConditionalOutput; key?: string; failure?: IResourceFailure }> {
		const { name, version, subpath } = request;
		const path = subpath === '.' ? '' : `/${subpath.slice(2)}`;
		const { selected, errors } = await this.#selection.resolve(`${name}@${version}${path}`);
		if (!selected && this.#installed?.serves(errors[0]?.code, request, conditions)) {
			const installed = await this.#installed.module({ name, version, subpath }, conditions);
			if (installed.module?.styles) return { styles: installed.module.styles, key: 'installed' };
			if (installed.module) return { failure: { code: 'OUTPUT_NOT_AVAILABLE', message: `Module "${name}${subpath.slice(1)}" produces no stylesheet` } };
			return { failure: this.#failure([installed.failure]) };
		}
		if (!selected) return { failure: this.#failure(errors) };

		const compilation = new Compilation(selected.package, subpath, new Conditions(conditions), this.#dependencies);
		await compilation.run();
		// A style module builds a stylesheet and no code, so its compilation is not valid and its stylesheet is
		const { styles } = compilation;
		if (!compilation.valid && !styles) {
			const message = `Module "${selected.specifier}" does not build: ${compilation.errors[0].message}`;
			return { failure: { code: 'BUILD_FAILED', message, diagnostics: compilation.errors } };
		}
		if (styles) return { styles, key: compilation.key };
		return { failure: { code: 'OUTPUT_NOT_AVAILABLE', message: `Module "${selected.specifier}" produces no stylesheet` } };
	}

	/**
	 * A declared static file of a package, by its path inside the package
	 */
	async asset(request: { name: string; version: string; path: string }): Promise<{ content?: Buffer; failure?: IResourceFailure }> {
		const { name, version, path } = request;
		await this.#workspace.ready;
		const packages = [...this.#workspace.packages.values()];
		await Promise.all(packages.map(one => one.ready));

		// Several versions of one name are instances: the request names the one it reads from
		const instances = packages.filter(one => one.valid && one.name === name);
		if (!instances.length) return { failure: { code: 'PACKAGE_NOT_FOUND', message: `Package "${name}" is not in the workspace` } };
		const matching = instances.filter(one => one.version === version);
		if (!matching.length) {
			const held = instances.map(one => one.vname).join(', ');
			const which = instances.length === 1 ? `the workspace package is ${held}` : `the workspace packages are ${held}`;
			return { failure: { code: 'VERSION_MISMATCH', message: `"${name}@${version}" was requested, but ${which}` } };
		}

		// One name and version at two directories cannot be told apart, as the selection of a module refuses
		if (matching.length > 1) {
			const message = `Package "${name}@${version}" is declared by more than one workspace package: ${matching.map(one => one.path).join(', ')}`;
			return { failure: { code: 'BUILD_FAILED', message, diagnostics: [{ code: 'PACKAGE_DUPLICATED', message }] } };
		}
		const [pkg] = matching;

		await pkg.modules.ready;
		const beyond = <{ assets?: unknown }>pkg.manifest.beyond;
		const declared: string[] = beyond?.assets instanceof Array ? beyond.assets.filter(one => typeof one === 'string') : [];
		pkg.modules.specs.forEach(spec => {
			const { assets } = <{ assets?: unknown }>spec.values;
			assets instanceof Array && assets.forEach(one => typeof one === 'string' && declared.push(posix.join(spec.path ?? '', one)));
		});

		const missing = { code: <const>'OUTPUT_NOT_AVAILABLE', message: `Package "${name}@${version}" does not declare the asset "${path}"` };
		if (!declared.map(one => posix.normalize(one)).includes(path)) return { failure: missing };

		const content = await fs.readFile(join(pkg.path, path)).catch(() => void 0);
		return content ? { content } : { failure: missing };
	}
}
