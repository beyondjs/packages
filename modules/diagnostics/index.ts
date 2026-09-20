import type { IDiagnosticsRequest, IDiagnosticsResult, IModuleInput, IPackageLike } from './types';
import { Check } from './check';
import { posix } from 'path';

/**
 * Semantic TypeScript diagnostics of one public module.
 *
 * Generation transforms each source on its own, which reports what does not parse and nothing else: a
 * value of the wrong type, or a call that does not match the signature declared in another file, compiles.
 * A check builds the program of the module, with the types of its public dependencies, and reports what the
 * type checker finds, with the file relative to the package, the range and the compiler code.
 *
 * ```ts
 * const result = await Diagnostics.check({
 * 	module: { package: '@suite/app', root: '/path/to/app', subpath: './main', entry: 'main/index.ts' },
 * 	conditions: { platform: 'node' },
 * 	dependencies: { packages: { '@suite/shared': '/path/to/shared' } },
 * 	limits: { ms: 30000 }
 * });
 * ```
 *
 * The check is a capability, separate from generation and more expensive than it: whoever offers it decides
 * who may request it and accounts `measured`. It emits no code and never decides whether a module builds.
 */
export /*bundle*/ class Diagnostics {
	/**
	 * Checks one public module.
	 *
	 * It never throws and never names a location of the host. Problems of the code are `diagnostics`; a
	 * request that cannot be checked, a cancellation or an exceeded limit is the `outcome` of a result whose
	 * `complete` is false, with the diagnostics obtained until then. Types of public dependencies that were
	 * not found are warnings of the `types-unresolved` category, never errors of the module.
	 */
	static async check(request: IDiagnosticsRequest): Promise<IDiagnosticsResult> {
		return await new Check(request).run();
	}

	/**
	 * Describes a public module of a workspace package as the plain data `check()` takes
	 *
	 * @param pkg A package of a live workspace
	 * @param subpath The subpath of the module, such as `./message`
	 * @returns undefined when the package does not publish the subpath as a module compiled from sources
	 */
	static async module(pkg: IPackageLike, subpath: string): Promise<IModuleInput | undefined> {
		await pkg.ready;
		await pkg.modules.ready;

		const spec = pkg.modules.get(subpath)?.spec;
		if (!spec?.entry) return;

		const path = spec.path ?? '';
		const { name, version, path: root } = pkg;
		return { package: name, version, root, subpath, path, entry: posix.join(path, spec.entry) };
	}
}
