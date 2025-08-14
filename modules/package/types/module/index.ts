export /*bundle*/ interface IModuleSpec {
	id: string;
	bundle?: string; // Deprecated, use 'bundler' instead
	bundler?: string;
	name?: string; // Deprecated, use 'subpath' instead
	subpath?: string;
	description?: string;
}

export /*bundle*/ interface IModuleBundlerSpec {
	id: string;
	bundler?: string;
	subpath?: string;
	description?: string;
}
