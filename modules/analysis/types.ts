/**
 * One package version of a pinned graph. Only what analysis and generation read is listed.
 */
export /*bundle*/ interface IGraphNode {
	key?: string;
	name: string;
	version: string;
	integrity?: string | null;
	origin?: unknown;

	/**
	 * The edges of the node, as `imported name → node key`, when the graph does not list them apart
	 */
	dependencies?: Record<string, string>;

	[key: string]: unknown;
}

export /*bundle*/ interface IGraphEdge {
	from: string;

	/**
	 * null for an optional dependency that was skipped
	 */
	to: string | null;

	kind?: string;

	/**
	 * Peer edges: the node in whose context the peer was resolved
	 */
	context?: string;

	/**
	 * The name the dependent imports, when it differs from the name of the target (an alias)
	 */
	name?: string;

	[key: string]: unknown;
}

/**
 * The minimal `beyond-graph/1` input: nodes keyed `origin:name@version` and the edges between them
 */
export /*bundle*/ interface IGraph {
	protocol: 'beyond-graph/1';
	nodes: Record<string, IGraphNode> | IGraphNode[];
	edges?: IGraphEdge[];
	digest?: string;
}

/**
 * Where the extracted package root of every node is, by node key: the directory, or what a fetch answered
 * for the package, which also carries the integrity it verified (the only one a node without provider
 * metadata has). The list a fetch answers, whose items carry their `key`, is accepted as it is.
 */
export /*bundle*/ type SourcesType = Record<string, string | IFetched> | Map<string, string | IFetched> | IFetched[];

export /*bundle*/ interface IFetched {
	/**
	 * The node key, required when the sources are given as a list
	 */
	key?: string;
	extracted: string;
	integrity?: string;
}

export /*bundle*/ interface IAnalysisConditions {
	/**
	 * `browser` (or its synonym `web`) or `node`
	 */
	platform: string;
	environment?: 'development' | 'production';
}

/**
 * An application entry: a public specifier, optionally with the name of the application target it belongs
 * to (`web`, `backend`, …). Without one, the target is `web` for a browser and `backend` for Node.
 */
export /*bundle*/ type EntryType = string | { specifier: string; target?: string };

export /*bundle*/ interface ITraceRequest {
	graph: IGraph;
	sources: SourcesType;

	/**
	 * The application entry public modules: `@scope/app/main`, or `@scope/app@1.0.0/main` to select one
	 * node when the graph pins the package more than once
	 */
	entries: EntryType[];

	conditions: IAnalysisConditions;

	/**
	 * What the indeterminate dynamic imports of a module may load, by the specifier of the importing module
	 */
	declared?: Record<string, string[]>;

	/**
	 * The compiler that resolves and reads the sources, selected as in the esbuild bundler. There is no
	 * default: it is an input of every compatibility key.
	 */
	compiler: string;

	/**
	 * The module format the outputs will have, which is an input of their keys. `esm` when omitted.
	 */
	format?: 'esm' | 'system';
}

/**
 * Everything the compatibility key of an output is computed from, as `beyond-inventory/1` defines it. The
 * storage scope is never one of them.
 */
export /*bundle*/ interface IKeyInputs {
	/**
	 * `origin:name@version/subpath`
	 */
	module: string;

	/**
	 * The integrity of every source package that contributes input bytes
	 */
	sources: string[];

	/**
	 * The slice of the graph the output depends on: referenced package name → node key
	 */
	resolution: Record<string, string>;

	compiler: { name: string; version: string; configuration: string };
	conditions: string[];
	format: 'esm' | 'system' | 'none';
	output: 'js' | 'css' | 'asset';
}

/**
 * One output the application needs, as `beyond-inventory/1` defines it
 */
export /*bundle*/ interface IItem {
	/**
	 * `<kind>:<node key>/<subpath>`
	 */
	id: string;
	kind: 'module' | 'style' | 'asset';
	package: string;

	/**
	 * The public subpath without its leading `./` (`.` for the root module), or the path of an asset inside
	 * its package. The stylesheet a module produces has the subpath of that module.
	 */
	subpath: string;

	/**
	 * `eager` when the item is needed to evaluate an entry, `lazy` when only a dynamic import leads to it
	 */
	loading: 'eager' | 'lazy';

	/**
	 * The application targets whose entries reach the item
	 */
	targets: string[];

	media: string;

	/**
	 * The items that reference this one
	 */
	importers?: string[];

	/**
	 * A module that only a declaration reaches, or a static file a manifest declares
	 */
	declared?: boolean;

	inputs: IKeyInputs;

	/**
	 * The compatibility key: sha256 over the canonical JSON of `inputs`
	 */
	key: string;
}

export /*bundle*/ interface IUnknown {
	importer: string;
	expression?: string;
	location: { file: string; line: number; column: number };

	/**
	 * Whether a declaration covers the import
	 */
	declared: boolean;
	code: 'DYNAMIC_IMPORT_UNKNOWN' | 'DYNAMIC_IMPORT_DECLARED';
}

export /*bundle*/ interface IInventoryDiagnostic {
	code: string;
	message: string;
	severity?: 'error' | 'warning';
}

export /*bundle*/ interface IInventory {
	protocol: 'beyond-inventory/1';

	/**
	 * The digest of the graph that was traced
	 */
	graph: string;

	/**
	 * sha256 over the canonical JSON of this document without this member
	 */
	digest: string;

	entries: { target: string; package: string; subpath: string }[];
	items: IItem[];
	unknown: IUnknown[];
	diagnostics: IInventoryDiagnostic[];
}

/**
 * An inventory with what producing it cost. The cost is not part of the document, which is persisted and
 * compared by digest.
 */
export /*bundle*/ interface IMeasured {
	inventory: IInventory;

	/**
	 * Wall time, modules compiled in memory to read their references, and modules read from a distribution
	 * manifest. No compiled code is kept or returned.
	 */
	cost: { ms: number; compiled: number; read: number };

	/**
	 * The compiler that traced, as it identified itself
	 */
	compiler?: Record<string, unknown>;
}
