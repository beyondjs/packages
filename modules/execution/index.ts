import type {
	ExecutionState,
	IExecutionCurrent,
	IExecutionDiagnostic,
	IExecutionDocument,
	IExecutionEdge,
	IExecutionInputs,
	IExecutionMember,
	IExecutionNode,
	IExecutionResolution
} from './types';
import { Shape } from './shape';
import { Graph } from './graph';
import { Bindings } from './bindings';
import { Reader } from './reader';
import { Freshness } from './freshness';

/**
 * What reading the projection of a workspace answers. `execution` is present for the states `ready`,
 * `stale` and `incomplete`.
 */
export /*bundle*/ interface IExecutionRead {
	execution?: Execution;
	state: ExecutionState;
	diagnostics: IExecutionDiagnostic[];
}

/**
 * The execution projection of an installed workspace (`.beyond/execution.json`, `beyond-execution/1`): the
 * locked graph mapped to where each node's sources are on this machine. A consumer locates the instance an
 * importer is (`instance`) and follows that instance's edges (`resolve`); it never chooses a version again
 * and never resolves a bare name against a flat list of packages.
 */
export /*bundle*/ class Execution {
	/**
	 * Where the projection is kept, relative to the workspace root
	 */
	static PATH = Reader.PATH;

	/**
	 * The name of the lock file at the workspace root (`beyond-lock.json`), which every reader and writer uses
	 */
	static LOCK = Freshness.LOCK;

	#document: IExecutionDocument;
	#graph: Graph;
	#bindings: Bindings;
	#state: ExecutionState;
	#diagnostics: IExecutionDiagnostic[];

	/**
	 * Builds the indexes of a validated document. Use `Execution.from` or `Execution.read`.
	 */
	private constructor(document: IExecutionDocument, state: ExecutionState, diagnostics: IExecutionDiagnostic[]) {
		this.#document = document;
		this.#graph = new Graph(document);
		this.#bindings = new Bindings(this.#graph, document.edges);
		this.#state = state;
		this.#diagnostics = diagnostics;
	}

	/**
	 * The projection of a document already in memory, considered ready.
	 *
	 * @param data A parsed `beyond-execution/1` document
	 * @param root The canonical workspace root the document must have been written for
	 * @throws An error with the code `EXECUTION_GRAPH_INCOMPATIBLE` when the document is not a usable
	 *   projection of that root
	 */
	static from(data: object, root: string): Execution {
		return new Execution(Shape.check(data, root), 'ready', []);
	}

	/**
	 * Reads the projection of a workspace root and establishes its state. It never rejects for the content it finds.
	 *
	 * - `missing`: there is no projection;
	 * - `incompatible`: it is unreadable, of another protocol or of another root, or it locates a node where it may
	 *   not be: an external node outside its store's directory for it, or a member elsewhere than its node or than
	 *   the workspace declares (`current.locations`, with `details.changed: ['member:<id>']`);
	 * - `incomplete`: the sources of a node are not at their location (`SOURCE_MISSING` per node);
	 * - `stale`: the given inputs or the lock at the root differ from those it was built from (a missing lock
	 *   counts as different);
	 * - `ready` otherwise.
	 *
	 * @param root The workspace root; it is made canonical
	 * @param current What the workspace declares now: its inputs (`Declaration.inputs`) and the canonical
	 *   directory of each member by id; without them only the lock and the locations it records are checked
	 */
	static async read(root: string, current?: IExecutionCurrent): Promise<IExecutionRead> {
		const { document, state, diagnostics } = await Reader.read(root, current || {});
		if (!document) return { state, diagnostics };
		return { execution: new Execution(document, state, diagnostics), state, diagnostics };
	}

	/**
	 * How usable the projection was found: `ready`, `stale` or `incomplete` (an `Execution` exists for no other)
	 */
	get state(): ExecutionState {
		return this.#state;
	}

	/**
	 * `EXECUTION_GRAPH_STALE` (with `details.changed`: `declaration`, `member:<id>`, `lock`) and `SOURCE_MISSING`
	 * per node, as reading the projection found them
	 */
	get diagnostics(): IExecutionDiagnostic[] {
		return [...this.#diagnostics];
	}

	/**
	 * The canonical workspace root the projection was written for
	 */
	get root(): string {
		return this.#document.root;
	}

	/**
	 * The digest of the lock the projection was built from
	 */
	get lock(): string {
		return this.#document.lock;
	}

	/**
	 * The inputs the installation recorded: digests of the declaration and of each member manifest
	 */
	get inputs(): IExecutionInputs {
		return JSON.parse(JSON.stringify(this.#document.inputs));
	}

	/**
	 * The root of the store the external nodes were fetched into
	 */
	get store(): string {
		return this.#document.store;
	}

	/**
	 * When the projection was written (ISO-8601)
	 */
	get written(): string {
		return this.#document.written;
	}

	/**
	 * The members of the workspace by id
	 */
	get members(): Map<string, IExecutionMember> {
		return new Map(this.#graph.members);
	}

	/**
	 * Every node of the projection by key
	 */
	get nodes(): Map<string, IExecutionNode> {
		return new Map(this.#graph.nodes);
	}

	/**
	 * A node with its location, or undefined when the graph has no such key
	 */
	node(key: string): IExecutionNode | undefined {
		return this.#graph.node(key);
	}

	/**
	 * The keys of the nodes of a name, and of one version when it is given, sorted
	 */
	find(name: string, version?: string): string[] {
		return this.#graph.find(name, version);
	}

	/**
	 * The key of the node whose location is the given canonical directory: which instance a package read
	 * from that directory is
	 */
	instance(path: string): string | undefined {
		return this.#graph.instance(path);
	}

	/**
	 * The edges of a node, as the lock records them
	 */
	edges(from: string): IExecutionEdge[] {
		return this.#bindings.of(from);
	}

	/**
	 * The node an import reaches. A node imports itself by its own name; any other name follows the importer's
	 * edges for it (an alias edge by its declared name): the edge whose `context` is the given context wins,
	 * then the edge without a context, then a target every edge agrees on. Otherwise the binding depends on a
	 * context that was not given or that binds none of them (`PEER_CONTEXT_AMBIGUOUS`); a name the importer's
	 * edges do not provide is `DEPENDENCY_NOT_INSTALLED`, never a guess by name.
	 *
	 * @param from Key of the importing node
	 * @param name The bare package name it imports
	 * @param context Key of the instance that reached the importer, for the peers it was given
	 */
	resolve(from: string, name: string, context?: string): IExecutionResolution {
		return this.#bindings.resolve(from, name, context);
	}
}
