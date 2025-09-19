import type { BugsType, FundingType, IPackagePerson, IPackageRepository, IPackageManifest } from './';

// --------------------
// Package Metadata (a.k.a. Packument)
// This is the full document returned by the npm registry for a package.
// --------------------
export /*bundle*/ interface IPackument {
	/** CouchDB/registry internal id (optional) */
	_id?: string;

	/** CouchDB/registry revision field (optional) */
	_rev?: string;

	/** Package name */
	name: string;

	/** Short description of the package */
	description?: string;

	/** Distribution tags: e.g. "latest", "next", custom tags */
	'dist-tags': Record<string, string>;

	/**
	 * Versions map: each semver version string maps to a PackageManifest
	 * (the processed package.json + registry-specific fields).
	 */
	versions: Record<string, IPackageManifest>;

	/**
	 * Timeline of the package: created, modified, and timestamps for each version.
	 */
	time?: {
		created: string;
		modified: string;
		[version: string]: string;
	};

	/** List of maintainers (people with publish rights) */
	maintainers?: Array<IPackagePerson | string>;

	/** Readme content (string, often huge) */
	readme?: string;

	/** Readme file name (e.g., "README.md") */
	readmeFilename?: string;

	/** Homepage URL if specified */
	homepage?: string;

	/** Keywords specified in package.json */
	keywords?: string[];

	/** Repository information (URL, type, etc.) */
	repository?: IPackageRepository;

	/** Bugs tracker information (URL or email) */
	bugs?: BugsType;

	/** License type (e.g. MIT, Apache-2.0) */
	license?: string;

	/** Author information (person or string) */
	author?: IPackagePerson | string;

	/** Contributors list */
	contributors?: Array<IPackagePerson | string>;

	/** Map of npm usernames that starred the package */
	users?: Record<string, boolean>;

	/** Funding links (string, object, or array) */
	funding?: FundingType;

	/**
	 * Attachments: used by the CouchDB backend in npm registry.
	 * Usually not relevant for clients.
	 */
	_attachments?: Record<string, unknown>;

	/** Allow arbitrary future fields without breaking */
	[key: string]: unknown;
}
