import type { FilterSpec } from '@beyond-js/finder/types';

export /*bundle*/ interface IManifestModuleSpec {
	subpath?: string;
	description?: string;
}

export /*bundle*/ interface IManifestSpec extends IManifestModuleSpec {
	bundle?: string; // Deprecated, use 'bundler' instead
	bundler?: string;
	name?: string; // Deprecated, use 'subpath' instead

	static: string | FilterSpec; // Path to the static resources

	// Any other property is considered a bundler configuration
	[bundler: string]: IManifestModuleSpec | FilterSpec | string;
}
