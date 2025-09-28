import type { ICollection } from './collection';

export /*bundle*/ interface IPackageData {
	identifier: string; // Unique identifier for the package, e.g., "react@18.2.0" or "github.com/facebook/react@main"
}

export /*bundle*/ type Packages = ICollection<IPackageData>;
