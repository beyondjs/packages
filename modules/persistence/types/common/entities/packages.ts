import type { ICollection } from './collection';
import type { IPackageManifest } from '@beyond-js/packages/types';

export /*bundle*/ interface IPackageReleaseData {
	id: string; // Unique identifier for the package + version (version, tag, or commit)
	public: boolean; // Indicates if the package is public
	spec: IPackageManifest; // The actual package manifest (package.json content)
}

export /*bundle*/ interface IPackageData {
	id: string; // Unique identifier for the package
	public: boolean; // Indicates if the package is public

	/**
	 * List of available versions for the package. Only semver versions are listed here.
	 */
	versions: string[];
}

export /*bundle*/ type Releases = ICollection<IPackageReleaseData>;
export /*bundle*/ type Packages = ICollection<IPackageData>;
