import type { IPackageManifest } from '@beyond-js/packages/types';
import type { IProvidersOptions } from '@beyond-js/packages/providers';
import type { ILimits, SourcesTransport } from '@beyond-js/packages/sources';
import type { IGraphLogger } from '@beyond-js/packages/dependencies/graph';

/**
 * A member of the workspace, as its declaration reads it
 */
export /*bundle*/ interface IInstallationMember {
	// POSIX path of the member directory relative to the workspace root (`.` for the root itself)
	id: string;
	name: string;
	version: string;
	// Absolute directory of the member; its real path is the one recorded
	path: string;
	manifest: IPackageManifest;
}

/**
 * What an installation is made from
 */
export /*bundle*/ interface IInstallationParams {
	// Workspace root (the package root of a standalone package); its real path is the one recorded
	root: string;
	// The members the declaration reads
	members: IInstallationMember[];
	// The inputs of the declaration (`Declaration.inputs`), recorded as given in the lock and the projection
	inputs: object;
	// The root manifest of an npm or beyond.json workspace: its dependency groups and `overrides`
	manifest?: IPackageManifest;
	// Root of the source store; `BEYOND_SOURCES_DIR`, else the `sources` directory of the user's cache. Created
	// when absent, and recorded by its real path, as every location under it
	store?: string;
	// Root of the metadata cache; `BEYOND_METADATA_DIR`, else the `metadata` directory of the user's cache.
	// Created when absent and used by its real path
	metadata?: string;
	// Provider settings, merged over `{ workspace: root, path: root }`: the rc files of the user and the global
	// one and the environment are read as npm reads them, unless these options disable them
	providers?: IProvidersOptions;
	// When given, every request (metadata and archives) goes through it
	transport?: SourcesTransport;
	limits?: ILimits;
	// Milliseconds the whole installation may take; `BEYOND_INSTALL_DEADLINE`, else 540000
	deadline?: number;
	logger?: IGraphLogger;
}

/**
 * A release a resolution prefers while it satisfies what is required: what a lock records, or what a plan pins
 */
export /*bundle*/ interface IPreference {
	name: string;
	version: string;
}

/**
 * What an installation or a resolution tells while it runs. Nothing is estimated: a phase says what runs now, and a
 * request is told when it starts and when it was answered.
 */
export /*bundle*/ interface IInstallationEvent {
	// `resolution`: the workspace is resolved; `download`: its external sources are brought into the store (`total`
	// external nodes, the ones already stored included); `materialization`: every node is located, then the lock
	// and the projection are written
	phase?: 'resolution' | 'download' | 'materialization';
	total?: number;
	// A request: its address without user information, query or fragment, whether it asks for package metadata or
	// an archive, and whether the provider answered it (its status and headers arrived) or it failed
	request?: { url: string; kind: 'metadata' | 'archive'; answered: boolean };
}

/**
 * How an installation runs
 */
export /*bundle*/ interface IInstallOptions {
	// Resolve again ignoring the lock's selections
	update?: boolean;
	// Make no request: only a lock that covers the inputs, with every source already in the store, installs
	offline?: boolean;
	// Version preferences that replace the lock's (a list of `{name, version}`, or any form the resolver accepts as
	// a lock), as an accepted plan pins them. The workspace is then always resolved, never frozen, and the lock's own
	// selections are not offered. Combined with `update` it is `INSTALLATION_OPTIONS_INVALID`
	preferences?: IPreference[] | object;
	// Told what the installation does while it runs (see `IInstallationEvent`); a listener that throws is ignored
	progress?: (event: IInstallationEvent) => void;
}

/**
 * How a resolution without installation runs (`Installation.resolve`)
 */
export /*bundle*/ interface IResolveOptions {
	// As for an installation: the preferences that replace the lock's, or `update` to offer none
	preferences?: IPreference[] | object;
	update?: boolean;
	// Names whose published releases the answer also describes, read from the metadata the resolution read
	names?: string[];
	// Aborting it stops every request still running; the answer is then `RESOLUTION_CANCELLED`
	signal?: AbortSignal;
	progress?: (event: IInstallationEvent) => void;
}

/**
 * What resolving the workspace without installing it established. Nothing is fetched or written.
 */
export /*bundle*/ interface IResolution {
	// No error diagnostic: an installation with the same preferences would install this graph
	valid: boolean;
	// The graph the resolver answered, with or without errors; absent only when it answered no graph
	graph?: IInstalledGraph;
	// The digest of the lock this graph would be written as, with the inputs of the installation
	lock?: string;
	diagnostics: IInstallationDiagnostic[];
	// Package metadata requests the resolution made (a conditional one answered from the cache included), and the
	// milliseconds it took
	requests: number;
	duration: number;
	// The published releases of the names asked for
	releases: IReleases[];
}

/**
 * The releases a configured provider publishes for one name, as one request established them
 */
export /*bundle*/ interface IReleases {
	name: string;
	// The provider answered the package document
	found: boolean;
	// The base address of the registry the provider settings send this name to, without user information
	registry?: string;
	// `public`: read without a credential; `private`: read with one; `denied`: the registry refused the
	// credential or asked for one; `unknown`: no answer tells (the registry is unreachable, or has no such package)
	access: 'public' | 'private' | 'denied' | 'unknown';
	// Valid semver versions, the highest first
	versions: string[];
	// The distribution tags (`latest`, …)
	tags: Record<string, string>;
	// The deprecation message of each deprecated version
	deprecated: Record<string, string>;
	// When the answer was read (ISO-8601)
	checked: string;
	error?: { code: string; message: string };
}

/**
 * How the releases of several names are read (`Installation.releases`)
 */
export /*bundle*/ interface IReleasesOptions {
	// Aborting it stops the requests still running; names not read yet answer `RESOLUTION_CANCELLED`
	signal?: AbortSignal;
	// Told each name once its answer was read: `done` of `total`
	progress?: (item: { name: string; done: number; total: number }) => void;
}

/**
 * A finding of an installation
 */
export /*bundle*/ interface IInstallationDiagnostic {
	code: string;
	message: string;
	severity: 'error' | 'warning';
	// Key of the graph node concerned, when there is one
	node?: string;
}

/**
 * What an installation did. It is the only outcome: `install()` never rejects for a failure of the installation.
 * An installation that fails writes nothing, except when writing itself stops after the lock was put in place:
 * `lock.written` and `execution.written` then say exactly what is on disk.
 */
export /*bundle*/ interface IInstallationReport {
	protocol: 'beyond-installation/1';
	// No error diagnostic, and the lock and the projection were written or were already current
	valid: boolean;
	// The lock covered the inputs: resolution was skipped and no metadata was requested
	frozen: boolean;
	// `digest` is the digest of the lock now at `path`: the new one when this installation wrote it or found it
	// current, the previous one otherwise (absent when there is no sound lock)
	lock: { path: string; digest?: string; written: boolean };
	execution: { path: string; written: boolean };
	// `members`: the importers of the graph (the members, and the root when it declares dependencies);
	// `nodes`: every node, members' included; `fetched` and `reused`: the external sources downloaded and reused
	counts: { members: number; nodes: number; fetched: number; reused: number };
	diagnostics: IInstallationDiagnostic[];
}

/**
 * The graph an installation fetches, projects and locks: what `Resolution.workspace` answers and what a
 * `beyond-lock/2` document records, without diagnostics
 */
export /*bundle*/ interface IInstalledGraph {
	members: Record<string, { name: string; version: string; node: string }>;
	nodes: Record<string, Record<string, any>>;
	edges: Record<string, any>[];
	overrides: Record<string, any>[];
	exceptions: Record<string, any>[];
}

/**
 * The `beyond-lock/2` document: `beyond-lock.json` at the workspace root, committed by projects. It names no
 * machine path, store, credential or readiness.
 */
export /*bundle*/ interface ILockDocument extends IInstalledGraph {
	protocol: 'beyond-lock/2';
	inputs: object;
	// `sha256-` of the canonical JSON of every other member
	digest: string;
}
