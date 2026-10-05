import type { IPackageDependencies, IPackageManifest } from '@beyond-js/packages/types';
import type { IPackageProviders } from '@beyond-js/packages/providers/types';

export /*bundle*/ interface IProjectDependencies {
	get spec(): IPackageDependencies;
	install(): Promise<void>;
	update(): Promise<void>;
}

/**
 * A package a workspace declares, as the declaration of the workspace read it from disk
 */
export /*bundle*/ interface IWorkspaceMember {
	// The POSIX path of its directory relative to the workspace root (`packages/widgets`, `../message-v2`), `.` for
	// the root itself. Never absolute
	id: string;
	name: string;
	version: string;
	// The canonical absolute directory. It is where the member is read from, never part of a graph or a lock
	path?: string;
	manifest: IPackageManifest;
}

/**
 * The members of a workspace, as its dependency graph consults them. A name a member provides is owned by the
 * workspace: a version range of it is satisfied by the members alone, and no provider is ever asked about it.
 */
export /*bundle*/ interface IWorkspaceMembers {
	/**
	 * Whether a member provides the name
	 */
	owns(name: string): boolean;

	/**
	 * The members that provide a name, highest version first (then by id)
	 */
	instances(name: string): IWorkspaceMember[];

	/**
	 * A member by id. `.` is also the root package of the workspace when it is an importer without being a member
	 */
	member(id: string): IWorkspaceMember | undefined;

	/**
	 * Every package whose dependencies the workspace installs, by id: the members, and the root package (`.`)
	 * when it declares dependencies of its own without being a member
	 */
	get importers(): IWorkspaceMember[];
}

export /*bundle*/ interface IProject {
	get ready(): Promise<void>;
	get processed(): boolean;

	get name(): string;
	get version(): string;

	get dependencies(): IProjectDependencies;

	// It is a wrapper of the package providers, it adds cache and manages the permissions
	// that the project has on the package cache
	get packages(): IPackageProviders;

	// The members of a workspace. When present, the dependencies of the project are its importers, and the names
	// the members provide are resolved by the workspace instead of by any provider
	readonly members?: IWorkspaceMembers;
}
