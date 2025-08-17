// exports.d.ts
// Type-safe (but flexible) schema for package.json "exports"

/** A relative file path target. Node requires targets to start with "./". */
export type ExportPathType = `./${string}`;
export type ExportSubpathType = `./${string}`;

/**
 * A single "exports" target:
 * - a relative path,
 * - null (explicitly not exported),
 * - a condition map, or
 * - a fallback array of targets (evaluated in order).
 */
export type ExportsTargetType = ExportPathType | null | IExportsConditionMap | readonly ExportsTargetType[];

/**
 * Condition map. Key order matters at runtime.
 * Includes common Node conditions plus TypeScript’s "types".
 * Also allows arbitrary community conditions (e.g. "browser", "development",
 * "react-native", "deno", "bun", or versioned "types@>=x").
 */
export interface IExportsConditionMap {
	// Node-defined conditions
	import?: ExportsTargetType;
	require?: ExportsTargetType;
	node?: ExportsTargetType;
	'node-addons'?: ExportsTargetType;
	'module-sync'?: ExportsTargetType;
	default?: ExportsTargetType;

	// TypeScript-specific
	/** Usually points to a .d.ts path; TS recommends listing this first. */
	types?: ExportPathType | ExportsTargetType;

	/** Any additional condition (e.g., "browser", "types@>=4.6"). */
	[condition: string]: ExportsTargetType;
}

/**
 * Subpath map. "." is the main entry; additional keys must start with "./".
 * Keys may include patterns like "./*.js"; values can be any ExportsTarget.
 */
export interface IExportsSubpaths {
	'.': ExportsTargetType;
	[subpath: `./${string}`]: ExportsTargetType;
}

/**
 * The package.json "exports" field:
 * - Either a direct target (sugar for the "." subpath),
 * - or a subpath map.
 */
export type ExportsType = ExportsTargetType | IExportsSubpaths;
