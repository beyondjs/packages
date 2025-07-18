import type { ICollection } from '../db/collection';

export /*bundle*/ type PackageSource = 'npm' | 'github' | 'github-pkg' | 'gitlab' | 'artifactory' | 'url';

export /*bundle*/ interface IPackageData {
	key: string; // Unique key for the package, e.g., "react@18.2.0" or "github.com/facebook/react@main"
	source: PackageSource;

	name: string; // Package name or repo name
	version?: string; // Only for NPM or versioned sources
	owner?: string; // For GitHub, GitLab, etc.
	repo?: string; // For GitHub, GitLab, etc.
	ref?: string; // Git ref: branch, tag, or commit
	domain?: string; // For GitHub Packages, Artifactory, etc.

	timestamps: {
		created: number;
		updated?: number;
	};
}

export /*bundle*/ type Packages = ICollection<IPackageData>;
