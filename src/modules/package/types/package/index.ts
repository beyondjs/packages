export /*bundle*/ interface IPackageJSON {
	// Metadata
	name?: string;
	version?: string;
	private?: boolean;
	description?: string;
	keywords?: string[];
	homepage?: string;
	bugs?: string | { url?: string; email?: string };
	license?: string;
	author?: Person | string;
	contributors?: (Person | string)[];
	funding?: string | { type?: string; url?: string };

	// Repository
	repository?: string | { type?: string; url?: string; directory?: string };

	// Entry points / module system
	type?: 'commonjs' | 'module';
	main?: string;
	module?: string; // legacy ESM entry used by some bundlers
	browser?: string | Record<string, string | false>;
	types?: string; // TS types entry
	typings?: string; // legacy alias for types
	exports?: Exports; // modern export map
	sideEffects?: boolean | string[];

	// Files & publishing
	files?: string[];
	bin?: string | Record<string, string>;
	man?: string | string[];
	directories?: {
		bin?: string;
		doc?: string;
		example?: string;
		lib?: string;
		man?: string;
		test?: string;
	};
	publishConfig?: Record<string, unknown>;
	packageManager?: string; // e.g. "pnpm@9.0.0", "npm@10.8.1"

	// Scripts & config
	scripts?: Record<string, string>;
	config?: Record<string, unknown>;

	// Dependencies
	dependencies?: Record<string, string>;
	devDependencies?: Record<string, string>;
	peerDependencies?: Record<string, string>;
	optionalDependencies?: Record<string, string>;
	bundleDependencies?: string[]; // legacy alias
	bundledDependencies?: string[]; // alias
	peerDependenciesMeta?: Record<
		string,
		{
			optional?: boolean;
		}
	>;

	// Platform constraints
	engines?: Record<string, string>;
	os?: string[];
	cpu?: string[];

	// Monorepos / workspaces
	workspaces?: string[] | { packages?: string[]; nohoist?: string[] };

	// Ecosystem-specific (optional, common keys)
	eslintConfig?: Record<string, unknown>;
	prettier?: Record<string, unknown>;
	jest?: Record<string, unknown>;
	babel?: Record<string, unknown>;
	tsconfig?: Record<string, unknown>;
	browserslist?: string[] | Record<string, string | string[]>;
	nyc?: Record<string, unknown>;

	// Yarn/PNPM/NPM specific extras (optional)
	resolutions?: Record<string, string>; // Yarn
	pnpm?: Record<string, unknown>;
	overrides?: Record<string, string | Record<string, string>>; // npm 8+

	// Allow other custom fields
	[key: string]: unknown;
}

export interface Person {
	name: string;
	email?: string;
	url?: string;
}

export type Exports =
	| string
	| Record<
			string,
			| string
			| {
					types?: string;
					import?: string;
					require?: string;
					default?: string;
					node?: string | Record<string, string>;
					browser?: string | Record<string, string>;
					development?: string | Record<string, string>;
					production?: string | Record<string, string>;
			  }
	  >;
