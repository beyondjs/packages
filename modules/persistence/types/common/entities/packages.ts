import type { ICollection } from './collection';
import type { IPackageManifest } from '@beyond-js/packages/types';

export /*bundle*/ interface ICacheOptions {
	etag?: string;
	lastModified?: string;
}

/**
 * Only semver packages are listed here, as git packages do not have versions in the same way
 */
export /*bundle*/ interface IPackageData {
	id: string; // Unique identifier for the package
	public: boolean; // Indicates if the package is public
	versions: string[]; // List of available versions for the package.

	cache: ICacheOptions;
}

export /*bundle*/ interface IPackageReleaseData {
	id: string; // Unique identifier for the package + version (version, tag, or commit)
	public: boolean; // Indicates if the package is public
	manifest: IPackageManifest; // The actual package manifest (package.json content)

	cache: ICacheOptions;
}

export /*bundle*/ type Packages = ICollection<IPackageData>;
export /*bundle*/ type Releases = ICollection<IPackageReleaseData>;
