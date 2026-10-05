import type { IDiagnostic } from '@beyond-js/packages/types';
import type { Package } from '@beyond-js/packages/package';
import type { Execution, IExecutionEdge, IExecutionNode } from '@beyond-js/packages/execution';
import { realpathSync } from 'fs';
import { resolve } from 'path';

/**
 * How a bare specifier that a package imports is satisfied in a workspace
 */
export /*bundle*/ interface IWorkspaceImport {
	specifier: string;

	/**
	 * The name the specifier imports, such as `@scope/name`: the name of a package, or an alias of one
	 */
	name: string;

	/**
	 * The subpath of the module inside that package, such as `./message` or `.`
	 */
	subpath: string;

	/**
	 * The package of the workspace that provides it, when one does
	 */
	package?: Package;

	/**
	 * With an execution: the key of the node of the installed graph that the importer's edge reaches, such as
	 * `workspace:app` or `npm:react@19.1.1`
	 */
	key?: string;

	/**
	 * With an execution: that node, a member or an external package, with the location of its sources
	 */
	node?: IExecutionNode;

	/**
	 * With an execution, for an import of another node: the edge the import follows, with the range the
	 * importer declares and, when a root override replaced that range, the selection of the override
	 */
	edge?: IExecutionEdge;

	/**
	 * Why the specifier is not satisfied: `DEPENDENCY_NOT_INSTALLED` or `PEER_CONTEXT_AMBIGUOUS` from the
	 * importer's edges, `EXECUTION_GRAPH_STALE` for an edge to a member the workspace no longer has, or that
	 * another package took the place of, `IMPORTER_REQUIRED` for a lookup without an importer in an installed
	 * graph, and `PACKAGE_AMBIGUOUS` or `PACKAGE_DUPLICATED` for a name that several packages of the workspace
	 * hold
	 */
	error?: IDiagnostic;
}

/**
 * What the imports of a workspace are resolved against: its packages by key and, when it was installed, the
 * execution projection of its graph
 */
export /*bundle*/ interface IImportsSource {
	packages: Map<string, Package>;
	execution?: Execution;
}

/**
 * Resolves the bare specifiers the packages of a workspace import.
 *
 * With an execution, the importer's edges in the installed graph decide: the importer is the node whose
 * location is its directory, the edge of the name reaches a node, and a member node is answered with the
 * package of that member. A missing edge is `DEPENDENCY_NOT_INSTALLED` and nothing is guessed by name, not
 * even without an importer. Locations are compared by their canonical paths, so a directory reached through a
 * symbolic link is the package it links to.
 *
 * Without an execution, a name is answered by the package of the workspace that has it. A name that several
 * packages hold is an error: several versions are `PACKAGE_AMBIGUOUS`, which only the installed graph can
 * decide, and one version at several directories is `PACKAGE_DUPLICATED`. The first package found is never
 * taken. A package always resolves its own name to itself.
 */
export /*bundle*/ class Imports {
	#source: IImportsSource;

	// The nodes of the projection by the canonical path of their locations, and the canonical path of each package
	#instances: Map<string, string>;
	#paths: WeakMap<Package, string> = new WeakMap();

	/**
	 * @param source The workspace whose packages import, read on every resolution: its packages change when
	 * it processes its declaration again, and its execution is the one it was created with
	 */
	constructor(source: IImportsSource) {
		this.#source = source;
	}

	/**
	 * The canonical path of a directory: its real path, or the resolved path of one that does not exist
	 */
	static real(path: string): string {
		try {
			return realpathSync(path);
		} catch {
			return resolve(path);
		}
	}

	/**
	 * Splits a bare specifier into the name of its package and its subpath
	 *
	 * @returns undefined when the specifier does not name a package: a relative or absolute path, a subpath
	 * import of the importing package (`#internal`), or an address with a scheme such as `node:fs`
	 */
	static parse(specifier: string): { name: string; subpath: string } | undefined {
		if (typeof specifier !== 'string' || !specifier || /^[./#]/.test(specifier)) return;

		const split = specifier.split('/');
		const scope = split[0].startsWith('@') ? split.shift() : void 0;
		const name = split.shift();
		if (!name || (scope && scope.length < 2) || `${scope ?? ''}${name}`.includes(':')) return;
		return { name: scope ? `${scope}/${name}` : name, subpath: split.length ? `./${split.join('/')}` : '.' };
	}

	/**
	 * Whether a node of the installed graph is a member of the workspace rather than an external package
	 */
	static member(key: string, node?: IExecutionNode): boolean {
		return key.startsWith('workspace:') || node?.origin?.provider === 'workspace';
	}

	/**
	 * The key of the node of the installed graph whose location is a directory, comparing canonical paths
	 *
	 * @returns undefined without an execution, or for a directory that is not the location of a node
	 */
	instance(path: string): string | undefined {
		const { execution } = this.#source;
		if (!execution || typeof path !== 'string' || !path) return;
		this.#instances ??= new Map([...execution.nodes.values()].map(node => [Imports.real(node.location), node.key]));
		return this.#instances.get(Imports.real(path));
	}

	/**
	 * How a bare specifier imported by a package is satisfied
	 *
	 * @param specifier The bare specifier, such as `@scope/name/subpath`
	 * @param importer The package that imports it. Without one, the specifier is resolved by name, which an
	 * installed graph never does.
	 * @param context For an importer that is an instance of the installed graph, the node that reached it,
	 * which selects a peer that was provided differently depending on the dependent
	 * @returns undefined when the specifier does not name a package
	 */
	resolve(specifier: string, importer?: Package, context?: string): IWorkspaceImport | undefined {
		const parsed = Imports.parse(specifier);
		if (!parsed) return;
		const found: IWorkspaceImport = { specifier, ...parsed };

		// A package composing its own public modules depends on nothing else; in the graph it is its own node
		const { execution } = this.#source;
		if (importer && importer.name === parsed.name) {
			const key = this.instance(importer.path);
			return key ? { ...found, package: importer, key, node: execution.node(key) } : { ...found, package: importer };
		}

		if (!execution) return this.#named(found);
		if (importer) return this.#edge(found, importer, execution, context);

		const message = `"${specifier}" is resolved by the edges of the package that imports it, and no importer was given`;
		return { ...found, error: { code: 'IMPORTER_REQUIRED', message } };
	}

	/**
	 * Resolves a name through the edges of the importer in the installed graph
	 */
	#edge(found: IWorkspaceImport, importer: Package, execution: Execution, context?: string): IWorkspaceImport {
		const from = this.instance(importer.path);
		if (!from) {
			const message =
				`"${importer.vname}" (${importer.path}) imports "${found.specifier}", but it is not a package of the ` +
				`installed graph: run beyond install`;
			return { ...found, error: { code: 'DEPENDENCY_NOT_INSTALLED', message } };
		}

		const resolved = execution.resolve(from, found.name, context);
		if (resolved.error) return { ...found, error: resolved.error };
		const { node } = resolved;
		const key = resolved.key ?? node?.key;
		if (!node || !key) {
			const message = `${from} imports ${found.name}, which its graph does not provide: declare it and run beyond install`;
			return { ...found, error: { code: 'DEPENDENCY_NOT_INSTALLED', message } };
		}
		const edge = Imports.#followed(execution, from, found.name, key, context);
		const reached = edge ? { key, node, edge } : { key, node };
		if (!Imports.member(key, node)) return { ...found, ...reached };

		const directory = Imports.real(node.location);
		const pkg = [...this.#source.packages.values()].find(one => this.#path(one) === directory);
		const stale = (why: string) => {
			const message = `The installed graph satisfies "${found.specifier}" of "${importer.vname}" with ${key} at ${node.location}, ${why}: run beyond install`;
			return { ...found, ...reached, error: { code: 'EXECUTION_GRAPH_STALE', message } };
		};
		if (!pkg) return stale('which is not a package of the workspace');

		// A package that has read its manifest must be the release the graph recorded at that location
		const other = pkg.name !== void 0 && (pkg.name !== node.name || pkg.version !== node.version);
		return other ? stale(`where the workspace now has ${pkg.vname}`) : { ...found, package: pkg, ...reached };
	}

	/**
	 * The canonical path of a package of the workspace, which does not change while the package exists
	 */
	#path(pkg: Package): string {
		!this.#paths.has(pkg) && this.#paths.set(pkg, Imports.real(pkg.path));
		return this.#paths.get(pkg);
	}

	/**
	 * The edge of the importer that an import of a name followed to a node: the one of the given context,
	 * else the one without a context, as the projection binds them
	 */
	static #followed(execution: Execution, from: string, name: string, to: string, context?: string): IExecutionEdge | undefined {
		const edges = (execution.edges?.(from) ?? []).filter(edge => edge.to === to && (edge.name ?? execution.node(to)?.name) === name);
		return edges.find(edge => context !== void 0 && edge.context === context) ?? edges.find(edge => !edge.context) ?? edges[0];
	}

	/**
	 * Resolves a name by the packages of the workspace that hold it
	 */
	#named(found: IWorkspaceImport): IWorkspaceImport {
		const holders = [...this.#source.packages].filter(([, pkg]) => pkg.name === found.name);
		if (!holders.length) return found;
		if (holders.length === 1) return { ...found, package: holders[0][1] };

		const instances = holders.map(([key, pkg]) => `${pkg.version} (${key})`).join(', ');
		const versions = new Set(holders.map(([, pkg]) => pkg.version));
		if (versions.size === 1) {
			const message = `Package "${holders[0][1].vname}" is declared by more than one workspace package: ${holders.map(([key]) => key).join(', ')}`;
			return { ...found, error: { code: 'PACKAGE_DUPLICATED', message } };
		}

		const message =
			`"${found.specifier}" names "${found.name}", which the workspace provides in more than one version: ` +
			`${instances}. Which one a package imports is decided by its installed graph: run beyond install`;
		return { ...found, error: { code: 'PACKAGE_AMBIGUOUS', message } };
	}
}
