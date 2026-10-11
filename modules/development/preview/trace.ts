/**
 * The package a record of a walk belongs to, as far as the walk knows it
 */
export interface ITraced {
	name: string;
	version?: string;
	subpath: string;

	/**
	 * The registry id its addresses name, when it has one: `npm` (unprefixed) or the id of another registry
	 */
	registry?: string;

	/**
	 * Who provides its sources: a member of the workspace, the toolchain (a supplied package), an installation on
	 * this machine, the store of an installed graph, or only a registry (a package nothing installs here)
	 */
	provider: 'workspace' | 'toolchain' | 'installation' | 'store' | 'registry';

	/**
	 * The versioned identity of a public module of the workspace
	 */
	vspecifier?: string;

	/**
	 * The directory of its package on this machine, when it has one
	 */
	path?: string;
}

/**
 * A public dependency between two records of a walk
 */
export interface ITracedEdge {
	from: string;
	to: string;
	specifier: string;

	/**
	 * Whether the dependency is the runtime the artifact is assembled against, which its sources do not import
	 */
	runtime?: boolean;
}

/**
 * What one walk of a preview reached, by record: the package of each record and the public dependencies between
 * records. It is the public-module graph of the page; the package graph and the files of each module are kept
 * apart from it by whoever reads it.
 */
export class Trace {
	#nodes: Map<string, ITraced> = new Map();
	#edges: Map<string, ITracedEdge> = new Map();

	get nodes(): ReadonlyMap<string, ITraced> {
		return this.#nodes;
	}

	get edges(): ITracedEdge[] {
		return [...this.#edges.values()];
	}

	/**
	 * Records the package of a record; a later call only adds what the first one did not know, such as the
	 * directory of an installation found when what it imports is walked
	 */
	node(id: string, traced: ITraced): void {
		const known = <Record<string, unknown>>(<unknown>this.#nodes.get(id));
		if (!known) return void this.#nodes.set(id, { ...traced });
		Object.entries(traced).forEach(([key, value]) => value !== void 0 && known[key] === void 0 && (known[key] = value));
	}

	/**
	 * Records a public dependency once; a runtime that the sources also import is an import of the sources
	 */
	edge(from: string, to: string, specifier: string, runtime = false): void {
		const key = `${from}\n${to}\n${specifier}`;
		const known = this.#edges.get(key);
		if (!known) return void this.#edges.set(key, { from, to, specifier, ...(runtime ? { runtime } : {}) });
		!runtime && delete known.runtime;
	}
}
