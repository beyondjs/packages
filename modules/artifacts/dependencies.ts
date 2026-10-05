import type { Workspace } from '@beyond-js/packages/workspace';
import type { Package } from '@beyond-js/packages/package';
import type { IDiagnostic } from '@beyond-js/packages/types';
import type { IArtifactDependency } from './types';
import { builtinModules } from 'module';
import { satisfies, valid } from 'semver';

/**
 * The runtime public module of an artifact that does not name its own. A composed artifact imports its
 * runtime, so it is classified apart from the dependencies between workspace packages and is never
 * version-checked, also when the workspace itself provides it.
 */
const RUNTIME = '@beyond-js/kernel/bundle';

/**
 * Resolves the public bare specifiers that the artifacts of a workspace require.
 *
 * A specifier provided by a package of the workspace must be satisfiable, which is checked here: the
 * dependent package declares the required package, and the version of the workspace package satisfies the
 * declared range. A public module of the same package needs no declaration, because a package does not
 * depend on itself. Anything the workspace does not provide is left to the environment that executes the
 * artifact, which is where the runtime, the Node builtins and the installed packages come from.
 *
 * With the execution projection of an installed graph, the dependent's edges decide: an edge to a member is
 * a workspace dependency, checked against that instance as above, except that the member a root override
 * selected answers to the selection of the override, which the edge records, and not to the declared range;
 * an edge to an external package is an external dependency of an exact version, node and location; a
 * specifier without an edge is `DEPENDENCY_NOT_INSTALLED`. A name several packages of the workspace hold is
 * never answered with the first.
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
	 * @param runtime The runtime public module the artifact was assembled against, when it names one
	 */
	async resolve(pkg: Package, specifiers: string[], errors: IDiagnostic[], runtime = RUNTIME): Promise<IArtifactDependency[]> {
		const resolved: IArtifactDependency[] = [];

		// The runtime package supplies every one of its public modules: the bundle the artifact imports and
		// the families (core, styles) that composed modules written against the Kernel identities map to
		const segments = runtime.split('/');
		const name = segments.slice(0, runtime.startsWith('@') ? 2 : 1).join('/');

		for (const specifier of specifiers) {
			if (specifier === runtime || specifier === name || specifier.startsWith(`${name}/`)) {
				resolved.push({ specifier, source: 'runtime' });
				continue;
			}

			if (specifier.startsWith('node:') || builtinModules.includes(specifier)) {
				resolved.push({ specifier, source: 'builtin' });
				continue;
			}

			const found = this.#workspace.imports.resolve(specifier, pkg);
			if (found?.error) {
				errors.push(found.error);
				continue;
			}
			if (!found?.package) {
				const { key, node } = found ?? {};
				resolved.push(node ? { specifier, source: 'external', node: key, version: node.version, location: node.location } : { specifier, source: 'external' });
				continue;
			}

			// A member reached by an edge is found by its directory, and may not have read its manifest yet
			const dependency = found.package;
			const resolution = { subpath: found.subpath, node: found.key };
			await dependency.ready;
			const { node } = found;
			if (node && (dependency.name !== node.name || dependency.version !== node.version)) {
				const message = `The installed graph satisfies "${specifier}" with ${found.key} (${node.name}@${node.version}), but the workspace has ${dependency.vname} at ${dependency.path}: run beyond install`;
				errors.push({ code: 'EXECUTION_GRAPH_STALE', message });
				continue;
			}

			/**
			 * A package composing its own public modules declares no dependency on itself, and the version
			 * involved is the one being built. Another one is declared under the name it is imported by, which
			 * an alias makes different from the name of the package.
			 */
			const own = dependency === pkg;
			const override = own ? void 0 : found.edge?.override;
			const range = own ? void 0 : this.#range(pkg, dependency, found, errors, override);
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
			const key = resolution.node ? { node: resolution.node } : {};
			resolved.push({ specifier, source: 'workspace', vspecifier, range, ...(override ? { override } : {}), ...key });
		}

		return resolved;
	}

	/**
	 * The version range a package declares for another package of the workspace, checked against the version
	 * of that workspace package
	 *
	 * @param imported The specifier and the name it imports: the name of the package, or an alias of it
	 * @param override The selection of a root override that replaced the declared range, which the version is
	 * checked against instead: an override is how the root deliberately selects another version than the range
	 * @returns The declared range, or undefined when the dependency is not declared or is not satisfied
	 */
	#range(pkg: Package, dependency: Package, imported: { specifier: string; name: string }, errors: IDiagnostic[], override?: string): string | undefined {
		const declared = Object.assign({}, pkg.dependencies, pkg.peerDependencies, pkg.devDependencies);
		const { specifier, name } = imported;
		const range = declared[name];

		if (typeof range !== 'string') {
			const code = 'DEPENDENCY_NOT_DECLARED';
			const message = `Package "${pkg.name}" imports "${specifier}" but does not declare "${name}" in its package.json dependencies`;
			errors.push({ code, message });
			return;
		}

		// A wildcard or workspace-protocol range selects the workspace package whatever its version is
		const { version } = dependency;
		const required = override ?? range;
		const any = required === '*' || required.startsWith('workspace:');
		if (!any && !(valid(version) && satisfies(version, required, { includePrerelease: true }))) {
			const code = 'DEPENDENCY_INCOMPATIBLE';
			const requirement = override === void 0 ? `"${name}@${range}"` : `"${name}@${override}" (a root override of "${range}")`;
			const message = `Package "${pkg.name}" requires ${requirement} but the workspace package "${dependency.name}" is version "${version}"`;
			errors.push({ code, message });
			return;
		}

		return range;
	}
}
