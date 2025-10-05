import type { IPackageDependencies } from '@beyond-js/packages/types';
import type { IPackageProviders } from '@beyond-js/packages/providers/types';

export /*bundle*/ interface IProjectDependencies {
	get spec(): IPackageDependencies;
	install(): Promise<void>;
	update(): Promise<void>;
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
}
