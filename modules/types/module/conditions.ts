/**
 * Interface for module conditions. Includes known keys for improved semantics
 * and allows for custom conditions.
 */
export /*bundle*/ interface IConditions {
	platform: 'node' | 'browser' | 'deno' | 'node-addons' | 'module-sync' | 'types' | 'default' | string;
	environment?: 'development' | 'production';

	[key: string]: boolean | string | undefined;
}
