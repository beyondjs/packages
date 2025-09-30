import type { ICollection } from './collection';
import type { IPackageManifest } from '@beyond-js/packages/types';

export /*bundle*/ interface IPackageManifestData {
	identifier: string; // Unique identifier for the package + version (version, tag, or commit)
	public: boolean; // Indicates if the package is public
	spec: IPackageManifest; // The actual package manifest (package.json content)
}

export /*bundle*/ type Packages = ICollection<IPackageManifestData>;
