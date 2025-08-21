export /*bundle*/ interface IPackageExports {
	main?: string;
	module?: string;
	type?: 'module' | 'commonjs';
	types?: string;
	typings?: string; // legacy alias for types
	browser?: BrowserEntryType;
	exports?: ExportsType;
	sideEffects?: boolean | string[];
}

export /*bundle*/ type BrowserEntryType = string | false | IBrowserMapType;
export /*bundle*/ interface IBrowserMapType {
	[key: string]: BrowserEntryType;
}

/**
 * The package.json "exports" field:
 * - Either a direct target (sugar for the "." subpath),
 * - or a subpath map.
 */
export /*bundle*/ type ExportsType = IExportsSubpaths | ExportsTargetType;

/**
 * Subpath map. "." is the main entry; additional keys must start with "./".
 * Keys may include patterns like "./*.js"; values can be any ExportsTarget.
 */
export /*bundle*/ interface IExportsSubpaths {
	'.': ExportsTargetType;
	[subpath: ExportSubpathType]: ExportsTargetType;
}

/**
 * A single "exports" target:
 *
 * - ExportPathType: a relative path,
 * - null: (explicitly not exported),
 * - IExportsConditionMap: a condition map, or
 * - ExportsTargetType: a fallback array of targets (evaluated in order).
 */
export /*bundle*/ type ExportsTargetType = ExportPathType | null | IExportsConditionMap | readonly ExportsTargetType[];

/** A relative subpath and file path target, must start with "./". */
export type ExportSubpathType = `./${string}`;
export type ExportPathType = `./${string}`;

/**
 * Condition map. Key order matters at runtime.
 * Includes common Node conditions plus TypeScript’s "types".
 * Also allows arbitrary community conditions (e.g. "browser", "development",
 * "react-native", "deno", "bun", or versioned "types@>=x").
 */
export /*bundle*/ interface IExportsConditionMap {
	// Node-defined conditions
	node?: ExportsTargetType;
	'node-addons'?: ExportsTargetType;
	'module-sync'?: ExportsTargetType;
	deno?: ExportsTargetType;
	browser?: ExportsTargetType;
	import?: ExportsTargetType;
	require?: ExportsTargetType;
	development?: ExportsTargetType;
	production?: ExportsTargetType;
	default?: ExportsTargetType;

	// TypeScript-specific
	/** Usually points to a .d.ts path; TS recommends listing this first. */
	types?: ExportPathType | ExportsTargetType;

	/** Any additional condition (e.g., "browser", "types@>=4.6"). */
	[condition: string]: ExportsTargetType;
}
