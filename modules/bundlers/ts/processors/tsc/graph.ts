import type { Execution, IExecutionNode, IExecutionResolution } from '@beyond-js/packages/execution';
import type { Package } from '@beyond-js/packages/package';
import * as ts from 'typescript';
import { builtinModules } from 'module';
import { Slots } from './slots';
import { Nodes } from './nodes';

/**
 * The dependency groups whose `@types` packages a module's program includes
 */
const GROUPS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];

/**
 * The installed graph of a workspace, as the program that checks one module reaches it.
 *
 * With the execution projection of an installed graph, every bare specifier a file of the program imports
 * is resolved through the edges of the node that holds the file: the package of the module for its sources,
 * the package a declaration of the workspace belongs to for that declaration, and the node of the installed
 * graph for a file of an installed package. An edge to a member of the workspace is answered by the ambient
 * declaration of its module, which the program holds, and never by its sources. An external package and its
 * `@types` package are what the importer's edges reach, and TypeScript reads them from the locations of their
 * nodes ([Slots](./slots.ts)). A peer bound differently depending on the dependent is decided by the nodes
 * that reached the importer, nearest first. Nothing falls back to a `node_modules` directory, to the
 * installation of the toolchain or to its types. Paths are compared in their canonical form ([Nodes](./nodes.ts)).
 */
export class Graph {
	#execution: Execution;
	#pkg: Package;
	#slots: Slots;
	#nodes: Nodes;

	#member: string | undefined;

	/**
	 * The key of the node the package of the module is, or undefined when it is not part of the installed
	 * graph, which then resolves nothing for it
	 */
	get member(): string | undefined {
		return this.#member;
	}

	// The virtual declaration files of the workspace by the key of the node whose module they declare
	#owners: Map<string, string> = new Map();

	// The nodes that reached each node in this program, the nearest first
	#reachers: Map<string, string[]> = new Map();

	/**
	 * The graph a package's module is checked against, when its workspace has an execution
	 */
	static of(pkg: Package, directory: string): Graph | undefined {
		const execution = (<{ execution?: Execution }>(<unknown>pkg.workspace))?.execution;
		return execution ? new Graph(execution, pkg, directory) : void 0;
	}

	/**
	 * @param directory The directory of the module, the current directory of its program
	 */
	constructor(execution: Execution, pkg: Package, directory: string) {
		this.#execution = execution;
		this.#pkg = pkg;
		this.#slots = new Slots(directory);
		this.#nodes = new Nodes(execution);
		this.#member = this.#nodes.at(pkg.path);
		this.#member && this.#reachers.set(this.#member, []);
	}

	/**
	 * Whether a node is a member of the workspace, as `Imports.member` of the workspace tells it; the rule is
	 * repeated here so that this processor imports nothing but types from the workspace
	 */
	static #workspace(key: string, node?: IExecutionNode): boolean {
		return key.startsWith('workspace:') || node?.origin?.provider === 'workspace';
	}

	/**
	 * The bare specifiers that name another package than the one of the module, other than builtins: what a
	 * package that is not part of the installed graph cannot resolve
	 *
	 * @param own The name of the package of the module
	 */
	static foreign(specifiers: Iterable<string>, own: string): string[] {
		return [...specifiers].filter(specifier => {
			const name = Graph.#name(specifier);
			const builtin = specifier.startsWith('node:') || builtinModules.includes(name) || builtinModules.includes(specifier);
			return !!name && name !== own && !builtin;
		});
	}

	/**
	 * The `@types` packages the package of the module declares and its edges reach, by the name a `types`
	 * entry gives them: what TypeScript would include automatically from a `node_modules/@types` directory
	 */
	types(): string[] {
		const member = this.#member;
		if (!member) return [];

		const declared = new Set<string>();
		const manifest = <Record<string, unknown>>this.#pkg.manifest;
		GROUPS.forEach(group => {
			const names = manifest[group] && typeof manifest[group] === 'object' ? Object.keys(manifest[group]) : [];
			names.forEach(name => name.startsWith('@types/') && declared.add(name));
		});
		return [...declared]
			.filter(name => !this.#edge(member, name).error)
			.map(name => name.slice('@types/'.length))
			.sort();
	}

	/**
	 * Records that a virtual declaration file of the program declares a module of a package of the workspace,
	 * whose edges resolve what that declaration imports
	 *
	 * @param path The directory of that package
	 */
	own(file: string, path: string): void {
		const key = this.#nodes.at(path);
		key && this.#owners.set(file, key);
	}

	/**
	 * The node that holds a file of the program
	 */
	#from(file: string): string | undefined {
		return this.#owners.get(file) ?? this.#owners.get(file.replace(/\\/g, '/')) ?? this.#nodes.containing(file);
	}

	/**
	 * What the edge of a name reaches from a node. A peer the graph binds differently depending on the
	 * dependent is decided by the nodes that reached the importer in this program, the nearest first.
	 */
	#edge(from: string, name: string): IExecutionResolution {
		const resolved = this.#execution.resolve(from, name);
		if (resolved.error?.code !== 'PEER_CONTEXT_AMBIGUOUS') return resolved;

		for (const context of this.#reachers.get(from) ?? []) {
			const retried = this.#execution.resolve(from, name, context);
			if (!retried.error) return retried;
		}
		return resolved;
	}

	/**
	 * The external packages a node reaches for the package a specifier names: the package and its `@types`
	 * package, each where the edges of the node have it
	 *
	 * @returns undefined when the name reaches a member of the workspace, whose declaration answers instead
	 */
	#packages(from: string, name: string): Map<string, string> | undefined {
		const packages = new Map<string, string>();
		const names = name.startsWith('@types/') ? [name] : [name, `@types/${name.replace(/^@([^/]+)\//, '$1__')}`];
		for (const one of names) {
			const { key, node } = this.#edge(from, one);
			if (!node || !key) continue;
			if (Graph.#workspace(key, node)) {
				if (one === name) return;
				continue;
			}

			packages.set(one, node.location);
			// The first node to reach another is the context of the peers that one was given
			key !== from && !this.#reachers.has(key) && this.#reachers.set(key, [from, ...(this.#reachers.get(from) ?? [])]);
		}
		return packages;
	}

	/**
	 * The package a bare specifier names, as `@scope/name` or `name`
	 */
	static #name(specifier: string): string | undefined {
		if (!specifier || /^[./#]/.test(specifier) || specifier.includes(':')) return;
		const parts = specifier.split('/');
		const length = parts[0].startsWith('@') ? 2 : 1;
		return parts.length >= length && parts.slice(0, length).every(Boolean) ? parts.slice(0, length).join('/') : void 0;
	}

	/**
	 * Resolves a bare specifier that a file imports through the edges of the node that holds the file. A
	 * subpath import of the package (`#internal`) and what the author maps with `paths` or `baseUrl` are
	 * resolved from the file itself, and never from a `node_modules`. A member answers with nothing on disk:
	 * the ambient declaration of its module does.
	 */
	module(specifier: string, containing: string, options: ts.CompilerOptions): ts.ResolvedModuleWithFailedLookupLocations {
		const none: ts.ResolvedModuleWithFailedLookupLocations = { resolvedModule: void 0 };
		const { host } = this.#slots;
		const internal = specifier.startsWith('#');
		if (internal || options.paths || options.baseUrl) {
			const mapped = ts.resolveModuleName(specifier, containing, options, host);
			if (mapped.resolvedModule || internal) return mapped;
		}

		const name = Graph.#name(specifier);
		const from = name && this.#from(containing);
		if (!from) return none;

		const packages = this.#packages(from, name);
		if (!packages?.size) return none;
		return ts.resolveModuleName(specifier, this.#slots.file(`${from}|${name}`, packages), options, host);
	}

	/**
	 * Resolves a type reference (an entry of `types`, a `/// <reference types>` directive) through the edges of
	 * the node that holds the file that names it
	 */
	reference(name: string, containing: string, options: ts.CompilerOptions): ts.ResolvedTypeReferenceDirectiveWithFailedLookupLocations {
		const none: ts.ResolvedTypeReferenceDirectiveWithFailedLookupLocations = { resolvedTypeReferenceDirective: void 0 };
		const pkg = Graph.#name(name);
		// The names `types` lists are resolved for the module, whose inferred file is in its directory
		const from = pkg && (this.#from(containing) ?? this.#member);
		if (!from) return none;

		const packages = this.#packages(from, pkg);
		if (!packages) return none;
		const file = this.#slots.file(`${from}|${pkg}`, packages);
		return ts.resolveTypeReferenceDirective(name, file, options, this.#slots.host);
	}
}
