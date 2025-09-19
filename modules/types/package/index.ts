import type { BundlersSettingsType } from './bundlers';
import type { IPackageExports } from './exports';

export /*bundle*/ interface IPackageMetadata {}

export /*bundle*/ interface IPackagePerson {
	name: string;
	email?: string;
	url?: string;
}

export type IPackageRepository = { type?: string; url?: string; directory?: string };

export /*bundle*/ interface IDist {
	integrity?: string;
	shasum?: string;
	tarball: string;
	fileCount?: number;
	unpackedSize?: number;
	signatures?: Array<{ keyid: string; sig: string }>;
	// Legacy field in some registries
	'npm-signature'?: string;
}

export /*bundle*/ type FundingType = string | { type?: string; url: string } | Array<{ type?: string; url: string }>;

export type BugsType = string | { url?: string; email?: string };

export /*bundle*/ interface IBeyondPackageManifest extends IPackageManifest {
	bundlers: BundlersSettingsType;
	modules: string | { path: string };
}

export /*bundle*/ interface IPackageManifest extends IPackageExports {
	// Metadata
	name?: string;
	version?: string;
	private?: boolean;
	description?: string;
	keywords?: string[];
	homepage?: string;
	bugs?: BugsType;
	license?: string;
	author?: IPackagePerson | string;
	contributors?: (IPackagePerson | string)[];
	funding?: FundingType;

	// Repository
	repository?: IPackageRepository | string;

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
	peerDependenciesMeta?: Record<string, { optional?: boolean }>;

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

	deprecated?: string;

	// Fields added by the registry to a version's manifest
	dist?: IDist;

	// Allow other custom fields
	[key: string]: unknown;
}
