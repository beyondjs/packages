import type { Workspace } from '@beyond-js/packages/workspace';
import type { Package } from '@beyond-js/packages/package';
import type { IDiagnostic } from '@beyond-js/packages/types';
import type { IArtifactDependency } from './types';
import { builtinModules } from 'module';
import { satisfies, valid } from 'semver';

/**
 * The runtime public module. Every artifact imports it, so it is classified apart from the dependencies
 * between workspace packages and is never version-checked.
 */
const KERNEL = '@beyond-js/kernel/bundle';

/**
 * Resolves the public bare specifiers that the artifacts of a workspace require.
 *
 * A specifier provided by a package of the workspace must be satisfiable, which is checked here: the
 * dependent package declares the required package, and the version of the workspace package satisfies the
 * declared range. A public module of the same package needs no declaration, because a package does not
 * depend on itself. Anything the workspace does not provide is left to the environment that executes the
 * artifact, which is where the runtime, the Node builtins and the installed packages come from.
 */
export class Dependencies {
	#workspace: Workspace;

	constructor(workspace: Workspace) {
		this.#workspace = workspace;
	}

	/**
	 * Classifies the specifiers required by the artifact of a package
	 *
	 * @param pkg The package that owns the artifact
	 * @param specifiers The bare specifiers collected from its internal modules
	 * @param errors Collects the diagnostics of the specifiers that cannot be satisfied
	 */
	async resolve(pkg: Package, specifiers: string[], errors: IDiagnostic[]): Promise<IArtifactDependency[]> {
		const resolved: IArtifactDependency[] = [];

		for (const specifier of specifiers) {
			if (specifier === KERNEL) {
				resolved.push({ specifier, source: 'runtime' });
				continue;
			}

			if (specifier.startsWith('node:') || builtinModules.includes(specifier)) {
				resolved.push({ specifier, source: 'builtin' });
				continue;
			}

			const resolution = this.#workspace.resolve(specifier);
			if (!resolution) {
				resolved.push({ specifier, source: 'external' });
				continue;
			}

			const dependency = resolution.package;

			/**
			 * A package composing its own public modules declares no dependency on itself, and the version
			 * involved is the one being built
			 */
			const own = dependency === pkg;
			const range = own ? void 0 : this.#range(pkg, dependency, specifier, errors);
			if (!own && !range) continue;

			await dependency.modules.ready;
			if (!dependency.modules.has(resolution.subpath)) {
				const code = 'MODULE_NOT_FOUND';
				const message =
					`Package "${pkg.name}" imports "${specifier}" but the package "${dependency.name}" ` +
					`does not declare the public module "${resolution.subpath}"`;
				errors.push({ code, message });
				continue;
			}

			const subpath = resolution.subpath.replace(/^\.\/?/, '');
			const vspecifier = subpath ? `${dependency.vname}/${subpath}` : dependency.vname;
			resolved.push({ specifier, source: 'workspace', vspecifier, range });
		}

		return resolved;
	}

	/**
	 * The version range a package declares for another package of the workspace, checked against the version
	 * of that workspace package
	 *
	 * @returns The declared range, or undefined when the dependency is not declared or is not satisfied
	 */
	#range(pkg: Package, dependency: Package, specifier: string, errors: IDiagnostic[]): string | undefined {
		const declared = Object.assign({}, pkg.dependencies, pkg.peerDependencies, pkg.devDependencies);
		const range = declared[dependency.name];

		if (typeof range !== 'string') {
			const code = 'DEPENDENCY_NOT_DECLARED';
			const message =
				`Package "${pkg.name}" imports "${specifier}" but does not declare ` +
				`"${dependency.name}" in its package.json dependencies`;
			errors.push({ code, message });
			return;
		}

		// A wildcard or workspace-protocol range selects the workspace package whatever its version is
		const { version } = dependency;
		const any = range === '*' || range.startsWith('workspace:');
		if (!any && !(valid(version) && satisfies(version, range, { includePrerelease: true }))) {
			const code = 'DEPENDENCY_INCOMPATIBLE';
			const message =
				`Package "${pkg.name}" requires "${dependency.name}@${range}" but the workspace package ` +
				`"${dependency.name}" is version "${version}"`;
			errors.push({ code, message });
			return;
		}

		return range;
	}
}
