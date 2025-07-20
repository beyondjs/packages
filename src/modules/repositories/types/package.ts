import type { RepositoriesErrorManager } from '@beyond-js/packages/repositories/errors';

export /*bundle*/ interface IPackageSpec {
	name: string;
	version: string;
	dependencies?: { [key: string]: string };
	devDependencies?: { [key: string]: string };
	peerDependencies?: { [key: string]: string };
}

export /*bundle*/ interface IPackageSpecResponse {
	name: string;
	version: string;
	found: boolean;
	value: IPackageSpec;
	error: RepositoriesErrorManager;
	valid: boolean;
}
