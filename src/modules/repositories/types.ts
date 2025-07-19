export interface PackageRegistry {
	getVersions(pkg: string): Promise<string[]>;
	getPackageJSON(pkg: string, version: string): Promise<any>;
}
