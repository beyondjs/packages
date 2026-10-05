import type { IProject, IProjectDependencies } from '@beyond-js/packages/project/types';
import type { IPackageProviders } from '@beyond-js/packages/providers/types';
import type { IPackageDependencies } from '@beyond-js/packages/types';
import type { IWorkspaceParams } from './types';
import { WorkspaceMembers } from './members';

/**
 * A workspace presented as the project the dependency graph resolves: a virtual root whose dependencies are the
 * importers of the workspace (`members`). What the root package declares of its own is kept as the project's
 * dependencies only for the overrides and the versions an override references (`"$name"`): its dependencies, when
 * it has any, are resolved through the importer it is.
 */
export class WorkspaceRoot implements IProject {
	readonly name = 'beyond-workspace';
	readonly version = '0.0.0';
	readonly processed = true;
	readonly ready = Promise.resolve();

	#packages: IPackageProviders;
	/**
	 * The metadata source every release outside the workspace is read from
	 */
	get packages() {
		return this.#packages;
	}

	#members: WorkspaceMembers;
	/**
	 * The members, which own the names they provide, and the importers of the workspace
	 */
	get members() {
		return this.#members;
	}

	#dependencies: IProjectDependencies;
	/**
	 * What the root package declares of its own: its overrides and the versions they reference
	 */
	get dependencies() {
		return this.#dependencies;
	}

	constructor(params: IWorkspaceParams, packages: IPackageProviders) {
		this.#packages = packages;
		this.#members = new WorkspaceMembers(params.members, params.root);

		// The root package: given as the root, or the member that is the root
		const manifest = params.root?.manifest || this.#members.member('.')?.manifest || {};
		const { dependencies, devDependencies, peerDependencies, optionalDependencies, overrides } = manifest;
		const spec = { dependencies, devDependencies, peerDependencies, optionalDependencies, overrides };

		const unavailable = async () => {
			throw new Error('A workspace is installed by its installation, not by its graph');
		};
		this.#dependencies = { spec: <IPackageDependencies>spec, install: unavailable, update: unavailable };
	}
}
