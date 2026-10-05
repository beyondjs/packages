import type { IProject } from '@beyond-js/packages/project/types';
import type { IDiagnostic } from '@beyond-js/packages/types';
import { DependencySource, DependencySourceIsType } from '@beyond-js/packages/dependency-source';

/**
 * The source an occurrence resolves, as its declaration and the workspace decide it:
 *
 * - the target of an alias: `npm:lodash@^4` resolves `lodash` from its registry;
 * - the workspace, for a version or a range of a name a member of the workspace provides: such a name is
 *   satisfied by the members alone, and no provider is ever asked about it. An alias is how a dependent reaches
 *   the registry copy of such a name instead;
 * - the declared source otherwise.
 *
 * A `workspace:` specifier names a member of the workspace whose package declares it, so only what is local to the
 * workspace may declare one: an importer (a member, or the root package) and the root's overrides. Declared by an
 * installed package (a registry, git or archive release), it is `SOURCE_UNSUPPORTED`: it names no member of the
 * workspace the package is installed in, and `Resolution.pin` refuses that release as well.
 */
export class NodeSource {
	#value?: DependencySource;
	/**
	 * The source to resolve; undefined only when the specifier could not be read at all
	 */
	get value() {
		return this.#value;
	}

	#error?: IDiagnostic;
	/**
	 * Why the declared specifier cannot be resolved
	 */
	get error() {
		return this.#error;
	}

	/**
	 * @param project The project of the graph, whose members own the names they provide
	 * @param pkg The name the dependent declares
	 * @param version The specifier in effect for it
	 * @param local Whether that specifier is local to the workspace: declared by the root of the graph, by an
	 *   importer, or supplied by an override of the root
	 */
	constructor(project: IProject, pkg: string, version: string, local: boolean) {
		let source: DependencySource;
		try {
			source = new DependencySource(pkg, version);
		} catch {
			this.#error = { code: 'INVALID_SPECIFIER', message: `Dependency "${pkg}" is not correctly specified` };
			return;
		}

		const { data } = source;
		if (data.is === DependencySourceIsType.Error) this.#error = data.error;
		if (data.is === DependencySourceIsType.Workspace && !local) {
			const message =
				`"${pkg}": "${version}" is a workspace: specifier declared by an installed package: only the members ` +
				`of a workspace may declare one, and it names no member of the workspace the package is installed in`;
			this.#error = { code: 'SOURCE_UNSUPPORTED', message };
		}

		const owned = data.is === DependencySourceIsType.Semver && !!project.members?.owns(pkg);
		this.#value = owned ? new DependencySource(pkg, `workspace:${source.spec}`) : source.target;
	}
}
