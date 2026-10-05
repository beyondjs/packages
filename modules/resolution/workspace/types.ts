import type { IPackageManifest } from '@beyond-js/packages/types';
import type { IWorkspaceMember } from '@beyond-js/packages/project/types';
import type { IGraphLogger } from '@beyond-js/packages/dependencies/graph';
import type { IPackageProviders } from '@beyond-js/packages/providers/types';
import type { IProvidersOptions } from '@beyond-js/packages/providers';
import type { IGraphNode, IGraphEdge, IGraphOverride, IGraphException, IGraphDiagnostic } from '../types';

/**
 * What the graph of a workspace is resolved from
 */
export /*bundle*/ interface IWorkspaceParams {
	// The root package of the workspace. Its dependency groups make it an importer (`.`) when it is not a member
	// and declares any; its `overrides` apply to every requirement. When a member is the root (`.`), the root
	// only supplies the overrides
	root?: { name?: string; manifest?: IPackageManifest };
	// The members the declaration of the workspace found: `{id, name, version, path, manifest}`
	members: IWorkspaceMember[];
	// A previous `beyond-lock/2`, `beyond-workspace-graph/1` or `beyond-graph/1` document, legacy lock entries or
	// a list of `{name, version}`: the registry releases it pins are preferred while they satisfy what is required
	lock?: any;
	// Provider settings, or an already built metadata source (a local installation passes its own `Metadata`).
	// Settings given here never read the rc files or the environment of the host unless they say so
	providers?: IProvidersOptions | IPackageProviders;
	// Ignore the preferences of the lock: the newest satisfying releases are selected
	update?: boolean;
	// Follow the development dependencies of the importers, as build dependencies. Default true
	development?: boolean;
	// Resolution passes allowed before failing with GRAPH_UNSETTLED
	passes?: number;
	logger?: IGraphLogger;
}

/**
 * A member of the workspace as a node of its graph: read from its directory, never from a provider
 */
export /*bundle*/ interface IWorkspaceNode {
	name: string;
	version: string;
	origin: { provider: 'workspace' };
	// The id of the member
	member: string;
	visibility: 'public';
	integrity: null;
	tarball: null;
}

/**
 * An importer of the workspace: a package whose own dependencies the workspace installs
 */
export /*bundle*/ interface IWorkspaceImporter {
	name: string;
	version: string;
	// `workspace:<id>`
	node: string;
}

/**
 * The resolved graph of a workspace (`beyond-workspace-graph/1`): the importers by member id, every node they
 * reach (the members as workspace nodes, the rest with the keys and descriptions of `beyond-graph/1`) and the
 * edges of each node. Like the pinned graph of an application it has no validity flag: it is usable when none
 * of its diagnostics is an error (`Resolution.valid`).
 */
export /*bundle*/ interface IWorkspaceGraph {
	protocol: 'beyond-workspace-graph/1';
	// The importers by id; `.` is present for the root package when it is an importer
	members: Record<string, IWorkspaceImporter>;
	nodes: Record<string, IGraphNode | IWorkspaceNode>;
	// A peer an importer declares is its own dependency (no `context`); below an importer, a peer edge names the
	// node in whose context it was provided
	edges: IGraphEdge[];
	overrides: IGraphOverride[];
	exceptions: IGraphException[];
	diagnostics: IGraphDiagnostic[];
	// 'sha256-<hex>' of the canonical JSON of every other member
	digest: string;
}
