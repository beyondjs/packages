/**
 * Interface for the 'exports' field in package.json.
 * It can be a simple string for the main entry point, or a record where keys
 * are export subpaths or conditions, and values are other exports entries.
 */
export /*bundle*/ interface IPackageModuleExports {
	exports?: ExportsEntry | IExportsMap;
	main?: string;
	module?: string;
	type?: 'module' | 'commonjs';
	browser?: string | IExportsMap;
}

/**
 * Represents a single export path or a conditional export object.
 * This can be a simple string pointing to a file, or a nested map of conditions.
 */
export /*bundle*/ type ExportsEntry = string | IExportsMap;

/**
 * Interface for a map of exports, where keys are subpaths or conditions.
 */
export /*bundle*/ interface IExportsMap {
	[key: string]: ExportsEntry;
}

/**
 * Interface for module conditions. Includes known keys for improved semantics
 * and allows for custom conditions.
 */
export /*bundle*/ interface IConditions {
	platform?: 'node' | 'browser' | 'deno' | 'default';
	type?: 'import' | 'require';
	environment?: 'development' | 'production';

	[key: string]: boolean | string | undefined;
}

/**
 * Interface for a single condition-target pair.
 */
export /*bundle*/ interface IConditional {
	conditions: IConditions;
	target: string;
}

/**
 * Interface for a module export entry, identified by a subpath.
 * It contains all the conditional targets for that subpath.
 */
export /*bundle*/ interface IModule {
	subpath: string;
	conditionals: IConditional[];
}
