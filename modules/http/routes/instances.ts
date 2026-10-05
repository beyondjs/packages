import { realpathSync } from 'fs';
import type { IOrigin } from './origins';

/**
 * A node of an execution projection as the routes read it: the release, where it came from and where its
 * sources are on this machine. A member of the workspace is a node too, of the provider `workspace`.
 */
export interface IInstance {
	name: string;
	version: string;
	origin?: { provider: string };
	location: string;
	member?: string;
}

/**
 * What a projection answers when an instance imports a package by name: the instance its edges select, or
 * why there is none (`DEPENDENCY_NOT_INSTALLED`, `PEER_CONTEXT_AMBIGUOUS`)
 */
export interface IBinding {
	key?: string;
	node?: IInstance;
	error?: { code: string; message: string };
}

/**
 * An edge of the installed graph, as the projection records it
 */
export interface IEdge {
	from: string;
	to: string | null;
	name?: string;
	context?: string;
}

/**
 * The part of the execution projection of `@beyond-js/packages/execution` that a development service reads to
 * address and resolve the instances it serves. It is declared here, by what is used, so the routes depend on the
 * meaning of the projection and not on the class that reads it.
 */
export interface IExecution {
	readonly nodes: Map<string, IInstance>;
	instance(path: string): string | undefined;
	node(key: string): IInstance | undefined;
	find(name: string, version?: string): string[];
	edges(from: string): IEdge[];
	resolve(from: string, name: string, context?: string): IBinding;
	readonly members: Map<string, { id: string; name: string; version: string; node: string; location: string }>;
}

/**
 * The instances of an installed workspace, as the routes of a development service address and resolve them.
 *
 * An installed workspace is served from its execution projection (`.beyond/execution.json`): every package a
 * module reaches is a node of the graph that `beyond install` resolved, and an importer imports the instance its
 * own edges select, never a package found by name. A peer is bound in the context of the instance that provided
 * it, which is one of the instances that reached the importer (`bind`). Where an instance came from is the
 * provider of its node, which is what its address names (`origin`).
 */
export class Instances {
	static WORKSPACE = 'workspace';
	static NPM = 'npm';

	/**
	 * The instances that are the context of some edge of a projection, which are the only ones a chain needs
	 */
	static #contexts: WeakMap<IExecution, Set<string>> = new WeakMap();

	#execution: IExecution;

	/**
	 * The instances of what a delivery serves, when it serves an installed workspace
	 *
	 * @param delivery A delivery, or the facade of a host over one, that may carry the execution it serves
	 * @returns undefined when the workspace is not served from an execution projection
	 */
	static of(delivery: unknown): Instances | undefined {
		const execution = (<{ execution?: IExecution }>delivery)?.execution;
		return execution ? new Instances(execution) : void 0;
	}

	constructor(execution: IExecution) {
		this.#execution = execution;
	}

	/**
	 * A directory as the projection names it: canonical, so a member reached through a symbolic link is still the
	 * instance at its real directory
	 */
	static #canonical(path: string): string {
		try {
			return realpathSync(path);
		} catch {
			return path;
		}
	}

	/**
	 * The node key of the package of a public module of the workspace: the one the delivery names, the member at
	 * its canonical directory, or else the member with its name and version
	 *
	 * @returns undefined for a package the projection does not know, such as a member declared after it was written
	 */
	importer(module: { name: string; version: string; path?: string; node?: string }): string | undefined {
		const located = module.node ?? (module.path ? this.#execution.instance(Instances.#canonical(module.path)) : void 0);
		if (located) return located;
		for (const member of this.#execution.members.values()) {
			if (member.name === module.name && member.version === module.version) return member.node;
		}
	}

	/**
	 * A node and its location, members included
	 */
	node(key: string): IInstance | undefined {
		const node = this.#execution.node(key);
		if (node) return node;
		const member = [...this.#execution.members.values()].find(one => one.node === key);
		return member && { name: member.name, version: member.version, origin: { provider: Instances.WORKSPACE }, member: member.id, location: member.location };
	}

	/**
	 * The keys of the nodes of a release, or of a name at any version, members included
	 */
	find(name: string, version?: string): string[] {
		const keys = new Set(this.#execution.find(name, version));
		this.#execution.members.forEach(member => member.name === name && (!version || member.version === version) && keys.add(member.node));
		return [...keys];
	}

	/**
	 * The chain of the instances that reached an import of `key`: `key` and the chain that reached it, nearest first,
	 * keeping only the instances some peer edge names as its context (no other one can decide a binding) and the
	 * nearest occurrence of each. Walks keyed by it visit an instance once per context that matters, not once per
	 * path, so a graph of shared packages is walked in a time that follows its size.
	 */
	extend(key: string, chain: string[]): string[] {
		let contexts = Instances.#contexts.get(this.#execution);
		if (!contexts) {
			contexts = new Set();
			for (const from of this.#execution.nodes.keys()) this.#execution.edges(from).forEach(({ context }) => context && contexts.add(context));
			Instances.#contexts.set(this.#execution, contexts);
		}
		return [key, ...chain].filter((one, index, all) => contexts.has(one) && all.indexOf(one) === index);
	}

	/**
	 * Whether a node is a member of the workspace
	 */
	member(node: IInstance): boolean {
		return node.origin?.provider === Instances.WORKSPACE || typeof node.member === 'string';
	}

	/**
	 * The instance an importer binds a package name to.
	 *
	 * A peer edge carries the instance in whose context the peer was provided, which is one of the instances that
	 * reached the importer. Those contexts are tried first, nearest first, and an edge of exactly that context wins:
	 * an importer's own peer edge has no context (it is how the package binds the peer when it is developed on its
	 * own), so taking the edge without a context first would give a page reached through an application a second
	 * release of the peer. Only when no instance of the chain is a context, the projection answers as it does without
	 * one: a package imports itself by its own name, then the edge without a context, then the one target every edge
	 * agrees on; otherwise `PEER_CONTEXT_AMBIGUOUS`, or `DEPENDENCY_NOT_INSTALLED` without an edge.
	 *
	 * @param from The node key of the importer
	 * @param name The package name it imports
	 * @param chain The instances that reached the importer, nearest first
	 */
	bind(from: string, name: string, chain: string[]): IBinding {
		const plain = this.#execution.resolve(from, name);
		if (plain.key === from || !chain.length) return this.#complete(plain);

		const named = (edge: IEdge) => edge.name ?? this.node(edge.to)?.name;
		const peers = this.#execution.edges(from).filter(edge => edge.to !== null && edge.context && named(edge) === name);
		for (const context of chain) {
			const targets = new Set(peers.filter(edge => edge.context === context).map(({ to }) => to));
			if (targets.size === 1) return this.#complete({ key: [...targets][0] });
		}
		return this.#complete(plain);
	}

	#complete(binding: IBinding): IBinding {
		if (!binding.key || binding.node) return binding;
		const node = this.node(binding.key);
		return node ? { key: binding.key, node } : { error: { code: 'SOURCE_MISSING', message: `The projection names "${binding.key}" and does not describe it` } };
	}

	/**
	 * Where an instance came from, as the paths of the compiled-module contract write it: a member of the workspace
	 * and the npm registry unprefixed, any other registry by the id of its provider. A node taken from Git or from
	 * an archive address has no registry address.
	 */
	origin(node: IInstance): IOrigin {
		const provider = node.origin?.provider;
		if (this.member(node) || provider === Instances.NPM) return { registry: Instances.NPM };
		if (provider?.startsWith('registry-')) return { registry: provider };
		const how = provider?.startsWith('git') ? 'from Git' : 'from an archive address';
		return { reason: `"${node.name}@${node.version}" was installed ${how}, which has no registry address` };
	}

	/**
	 * The path prefix an instance is addressed under, for messages: `/m/[<registry>/]<name>@<version>/…`
	 */
	address(node: IInstance): string {
		const { registry } = this.origin(node);
		return registry && registry !== Instances.NPM ? `/m/${registry}/${node.name}@${node.version}/…` : `/m/${node.name}@${node.version}/…`;
	}
}
