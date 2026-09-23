import type { DependencyKind } from '@beyond-js/packages/dependencies/spec';
import type { OverridesType, IGraphLogger } from '@beyond-js/packages/dependencies/graph';
import type { IMetadataStore, IPackageProviders } from '@beyond-js/packages/providers/types';
import type { IProvidersOptions } from '@beyond-js/packages/providers';

export /*bundle*/ interface IRoot {
	name: string;
	// Version specifier: a range, an exact version, an alias, a pinned git source or an archive URL
	range: string;
	// Defaults to 'main'
	kind?: DependencyKind;
	// Targets this root is selected for. Defaults to the targets of the resolution
	targets?: string[];
}

export /*bundle*/ interface IPinParams {
	// What the application requires, as a list or as a `{name: range}` record
	roots: IRoot[] | Record<string, string>;
	// Targets the graph is pinned for. Recorded and part of the digest
	targets?: string[];
	overrides?: OverridesType;
	// A previous `beyond-graph/1` document (or any form `Lock` accepts) whose releases are selected again
	lock?: any;
	// Provider settings, or an already built metadata source. Settings given here never read the rc
	// files or the environment of the host unless they say so (`user`, `global`, `env`)
	providers?: IProvidersOptions | IPackageProviders;
	// The organization the graph is pinned for: private metadata is cached within it
	tenant?: string;
	// Durable metadata cache shared between resolutions. Defaults to memory
	store?: IMetadataStore;
	// Follow the development dependencies of the roots, as build dependencies. Default false
	development?: boolean;
	// Resolution passes allowed before failing with GRAPH_UNSETTLED
	passes?: number;
	logger?: IGraphLogger;
}

export /*bundle*/ interface IGraphOrigin {
	// Identifier of the provider: `npm`, `registry-<slug>-<digest>` for another registry, `git-<slug>-<digest>`
	// for a repository at a commit, `digest` for an archive URL
	provider: string;
	// Canonical base of the registry or the repository, never with credentials
	registry?: string;
}

export /*bundle*/ interface IGraphRoot {
	name: string;
	// The requested exact version or range
	range: string;
	// Key of the node that satisfies it. Absent only when it could not be pinned (see diagnostics)
	node?: string;
	targets?: string[];
}

export /*bundle*/ interface IGraphNode {
	name: string;
	version: string;
	origin: IGraphOrigin;
	// `public` when the release is served without credentials, `private` otherwise and on any doubt
	visibility: 'public' | 'private';
	// Present only for a release read with a credential: `anonymous` when an anonymous probe found the same
	// release and archive (the node is public and fetched without the credential), `credential` otherwise
	access?: 'anonymous' | 'credential';
	// Subresource integrity of the archive. Null only for a node listed in `exceptions`
	integrity: string | null;
	// The archive URL the provider publishes for this release
	tarball: string;
	// Publication form, when the provider metadata exposes it
	publication?: 'source' | 'distribution' | 'npm';
}

export /*bundle*/ interface IGraphEdge {
	// Key of the dependent node
	from: string;
	// Key of the node that satisfies it; null for an optional dependency that was skipped
	to: string | null;
	// The name the dependent declares, when it is not the name of the target (an alias, a skipped edge)
	name?: string;
	kind: 'dependency' | 'peer' | 'optional' | 'build';
	// The range the dependent declares
	range: string;
	// For a peer: the node in whose context it was provided
	context?: string;
	// The override selection that replaced the declared range
	override?: string;
	// Why an optional edge has no target
	skipped?: string;
}

export /*bundle*/ interface IGraphOverride {
	name: string;
	selection: string;
	within?: string;
}

export /*bundle*/ interface IGraphException {
	node: string;
	// `manifest-fetch`: a manifest needed a request of its own; `archive-fetch`: an archive URL without an
	// integrity was downloaded once to pin its digest
	kind: 'manifest-fetch' | 'archive-fetch';
	provider: string;
	reason: string;
}

export /*bundle*/ interface IGraphDiagnostic {
	code: string;
	message: string;
	severity: 'error' | 'warning';
	// Key of the node concerned: the dependent of what failed, when it was pinned
	node?: string;
}

/**
 * The pinned graph, as specified by the `beyond-graph/1` schema of the CDN contracts. It has no validity
 * flag: a graph is usable when none of its diagnostics is an error (`Resolution.valid`).
 */
export /*bundle*/ interface IGraphDocument {
	protocol: 'beyond-graph/1';
	// 'sha256-<hex>' of the canonical JSON of every other member
	digest: string;
	roots: IGraphRoot[];
	nodes: Record<string, IGraphNode>;
	edges: IGraphEdge[];
	overrides: IGraphOverride[];
	lock: { reused: boolean; digest?: string };
	exceptions: IGraphException[];
	diagnostics: IGraphDiagnostic[];
}
