import type { IDiagnostic } from '@beyond-js/packages/types';

/**
 * How usable the execution projection of a workspace is:
 *
 * - `ready`: it was written from the current lock and inputs, and every node's sources are where it says;
 * - `missing`: there is no projection, the workspace was never installed (`EXECUTION_GRAPH_MISSING`);
 * - `stale`: the declaration, a member manifest or the lock changed since it was written
 *   (`EXECUTION_GRAPH_STALE`); it still describes the installation that was made;
 * - `incomplete`: the sources of one or more nodes are no longer where it says (`SOURCE_MISSING`);
 * - `incompatible`: unreadable, of another protocol or written for another root (`EXECUTION_GRAPH_INCOMPATIBLE`).
 */
export /*bundle*/ type ExecutionState = 'ready' | 'missing' | 'stale' | 'incomplete' | 'incompatible';

/**
 * A finding of the projection reader or of a resolution through the projection
 */
export /*bundle*/ interface IExecutionDiagnostic extends IDiagnostic {
	severity: 'error' | 'warning';
	// Key of the node concerned, when there is one
	node?: string;
	// Structured data of the finding: `changed` of a stale projection, `candidates` of an ambiguous binding, …
	details?: Record<string, any>;
}

/**
 * The inputs an installation was made from: digests of the workspace declaration and of each member manifest
 */
export /*bundle*/ interface IExecutionInputs {
	declaration?: string;
	members?: Record<string, string>;
	[member: string]: any;
}

/**
 * What a workspace declares now, which `Execution.read` compares a projection with
 */
export /*bundle*/ interface IExecutionCurrent {
	// The digests of the declaration and of each member manifest (`Declaration.inputs`)
	inputs?: object;
	// The canonical directory of each member, by id: a projection that locates a member elsewhere (another checkout
	// with the same manifest) is incompatible, and never served. An id on one side only is a change of the inputs
	locations?: Record<string, string>;
}

/**
 * A dependency edge between two nodes, as the `beyond-graph/1` and `beyond-lock/2` documents record it
 */
export /*bundle*/ interface IExecutionEdge {
	// Key of the dependent node
	from: string;
	// Key of the node that satisfies it; null for an optional dependency that was skipped
	to: string | null;
	// The name the dependent imports, when it is not the name of the target (an alias, a skipped edge)
	name?: string;
	kind: 'dependency' | 'peer' | 'optional' | 'build';
	// The range the dependent declares
	range: string;
	// For a peer provided by a dependent below an importer: the node in whose context it was provided
	context?: string;
	override?: string;
	skipped?: string;
}

/**
 * One node of the projection: a release of the graph or a workspace member, and where its sources are on
 * this machine
 */
export /*bundle*/ interface IExecutionNode {
	// `npm:react@19.1.1`, `registry-<slug>-<digest>:name@version`, `git:…@<commit>`, `digest:…` or `workspace:<id>`
	key: string;
	name: string;
	version: string;
	// Absolute directory of the package root: a member's directory, or the `files/` directory of a verified
	// source in the store
	location: string;
	origin?: { provider: string; registry?: string };
	// The member id, for a workspace node
	member?: string;
	visibility?: 'public' | 'private';
	integrity?: string | null;
	tarball?: string | null;
	[member: string]: any;
}

/**
 * A member of the workspace as the projection records it
 */
export /*bundle*/ interface IExecutionMember {
	// POSIX path of the member directory relative to the workspace root (`.` for the root itself)
	id: string;
	name: string;
	version: string;
	// `workspace:<id>`
	node: string;
	// Absolute directory of the member
	location: string;
}

/**
 * The `beyond-execution/1` document: `<root>/.beyond/execution.json`, written by an installation once every
 * node's sources are available. It is machine-local: it names absolute locations and is never committed.
 */
export /*bundle*/ interface IExecutionDocument {
	protocol: 'beyond-execution/1';
	// Canonical absolute directory of the workspace root
	root: string;
	// Digest of the `beyond-lock/2` document the projection was built from
	lock: string;
	inputs: IExecutionInputs;
	// Absolute root of the source store the external nodes were fetched into
	store: string;
	members: Record<string, Omit<IExecutionMember, 'id'>>;
	nodes: Record<string, Omit<IExecutionNode, 'key'>>;
	edges: IExecutionEdge[];
	// ISO-8601 time the projection was written
	written: string;
}

/**
 * What `Execution.resolve` answers: the node an import reaches, or why it reaches none
 */
export /*bundle*/ interface IExecutionResolution {
	key?: string;
	node?: IExecutionNode;
	error?: IExecutionDiagnostic;
}
