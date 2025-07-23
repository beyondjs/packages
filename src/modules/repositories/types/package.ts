export /*bundle*/ interface IDependenciesSpec {
	dependencies?: { [key: string]: string };
	devDependencies?: { [key: string]: string };
	peerDependencies?: { [key: string]: string };
}

export /*bundle*/ interface IPackageSpec extends IDependenciesSpec {
	name: string;
	version: string;
}
