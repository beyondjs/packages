import { type Selection, type Workspace } from '@beyond-js/packages/workspace';
import type { IDiagnostic, IConditions } from '@beyond-js/packages/types';
import type { ConditionalOutput } from '@beyond-js/packages/module/output';
import { promises as fs } from 'fs';
import { join, posix } from 'path';
import { Conditions } from './conditions';
import { Compilation } from './compilation';
import type { Dependencies } from './dependencies';

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

	constructor(workspace: Workspace, selection: Selection, dependencies: Dependencies) {
		this.#workspace = workspace;
		this.#selection = selection;
		this.#dependencies = dependencies;
	}

	#failure(errors: IDiagnostic[]): IResourceFailure {
		const [{ code, message }] = errors;
		const known = ['PACKAGE_NOT_FOUND', 'VERSION_MISMATCH', 'MODULE_NOT_FOUND'].includes(code);
		return { code: known ? <IResourceFailure['code']>code : 'BUILD_FAILED', message, diagnostics: errors };
	}

	/**
	 * The current stylesheet of a module, compiled on request like its code
	 */
	async styles(request: { name: string; version: string; subpath: string }, conditions: IConditions): Promise<{ styles?: ConditionalOutput; failure?: IResourceFailure }> {
		const { name, version, subpath } = request;
		const path = subpath === '.' ? '' : `/${subpath.slice(2)}`;
		const { selected, errors } = await this.#selection.resolve(`${name}@${version}${path}`);
		if (!selected) return { failure: this.#failure(errors) };

		const compilation = new Compilation(selected.package, subpath, new Conditions(conditions), this.#dependencies);
		await compilation.run();
		if (!compilation.valid) {
			const message = `Module "${selected.specifier}" does not build: ${compilation.errors[0].message}`;
			return { failure: { code: 'BUILD_FAILED', message, diagnostics: compilation.errors } };
		}

		const styles = (<{ styles?: ConditionalOutput }>(<unknown>compilation.conditional)).styles;
		if (styles) return { styles };
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

		const pkg = packages.find(one => one.valid && one.name === name);
		if (!pkg) return { failure: { code: 'PACKAGE_NOT_FOUND', message: `Package "${name}" is not in the workspace` } };
		if (pkg.version !== version) {
			return { failure: { code: 'VERSION_MISMATCH', message: `"${name}@${version}" was requested, but the workspace package is ${pkg.vname}` } };
		}

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
