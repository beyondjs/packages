export /*bundle*/ interface IPackageData {
	key: string; // Unique key for the package, e.g., "react@18.2.0" or "github.com/facebook/react@main"
	source: PackageSource;

	name: string; // Full package name with scope if applicable
	version?: string; // Only for NPM or versioned sources
	vname?: string; // Full package name with version (name@version | @scope/name@version)
	owner?: string; // For GitHub, GitLab, etc.
	repo?: string; // For GitHub, GitLab, etc.
	ref?: string; // Git ref: branch, tag, or commit
	domain?: string; // For GitHub Packages, Artifactory, etc.
}
