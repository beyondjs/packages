import { promises as fs, realpathSync } from 'fs';
import { join } from 'path';
import type { IBuildable, IPublishedModule, IServedExecution, IServedNode } from '../builds';

/**
 * An instance of the installed graph that an importer binds a package to, or why it binds none
 */
export interface IBound {
	key?: string;
	node?: IServedNode;
	error?: { code: string; message: string };
}

/**
 * The installed graph of the workspace, as a preview reads it from the execution projection the host serves.
 *
 * Nothing is looked for on the disk: the instance a package of the preview imports is the one its own edges
 * select, and a peer is the release provided by an instance that reached the importer (`bind`). This object
 * reads what the installation resolved; it resolves nothing itself.
 */
export class Instances {
	static WORKSPACE = 'workspace';

	/**
	 * The instances that are the context of some edge of a projection, which are the only ones a chain needs
	 */
	static #contexts: WeakMap<IServedExecution, Set<string>> = new WeakMap();

	#execution: IServedExecution;
	#delivery: IBuildable;

	/**
	 * @returns undefined when the host does not serve the workspace from an execution projection
	 */
	static of(delivery: IBuildable): Instances | undefined {
		return delivery.execution ? new Instances(delivery) : void 0;
	}

	constructor(delivery: IBuildable) {
		this.#delivery = delivery;
		this.#execution = delivery.execution;
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
	 * The instance of the package of a public module of the workspace: the one the host names, the member at its
	 * canonical directory, or else the member with its name and version. A member declared after the projection was
	 * written has none.
	 */
	importer(module: IPublishedModule): string | undefined {
		const located = module.node ?? (module.path ? this.#execution.instance(Instances.#canonical(module.path)) : void 0);
		if (located) return located;
		for (const member of this.#execution.members.values()) {
			if (member.name === module.name && member.version === module.version) return member.node;
		}
	}

	/**
	 * A node and its location, members included
	 */
	node(key: string): IServedNode | undefined {
		const node = this.#execution.node(key);
		if (node) return node;
		const member = [...this.#execution.members.values()].find(one => one.node === key);
		return member && { name: member.name, version: member.version, origin: { provider: Instances.WORKSPACE }, member: member.id, location: member.location };
	}

	/**
	 * The chain of the instances that reached an import of `key`: `key` and the chain that reached it, nearest first,
	 * keeping only the instances some peer edge names as its context (no other one can decide a binding) and the
	 * nearest occurrence of each, so a walk keyed by it visits an instance once per context that matters
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
	 * The keys of the instances of a name, members included
	 */
	find(name: string): string[] {
		const keys = new Set(this.#execution.find(name));
		this.#execution.members.forEach(member => member.name === name && keys.add(member.node));
		return [...keys];
	}

	/**
	 * Whether a node is a member of the workspace, whose modules the workspace publishes
	 */
	member(node: IServedNode): boolean {
		return node.origin?.provider === Instances.WORKSPACE || typeof node.member === 'string';
	}

	/**
	 * The instance an importer binds a package name to. A peer edge names the instance in whose context the peer
	 * was provided, one of the instances that reached the importer: those are tried first, nearest first, and an edge
	 * of exactly that context wins. An importer's own peer edge has no context (the binding of the package developed
	 * on its own), so it is taken only when no instance of the chain is a context, as the projection answers without
	 * one: the package itself by its own name, the edge without a context, or the one target every edge agrees on.
	 *
	 * @param chain The instances that reached the importer, nearest first
	 */
	bind(from: string, name: string, chain: string[]): IBound {
		const plain = this.#execution.resolve(from, name);
		if (plain.key === from || !chain.length) return this.complete(plain);

		const named = (edge: { to: string; name?: string }) => edge.name ?? this.node(edge.to)?.name;
		const peers = this.#execution.edges(from).filter(edge => edge.to !== null && edge.context && named(edge) === name);
		for (const context of chain) {
			const targets = new Set(peers.filter(edge => edge.context === context).map(({ to }) => to));
			if (targets.size === 1) return this.complete({ key: [...targets][0] });
		}
		return this.complete(plain);
	}

	/**
	 * The binding of a node by its key, with the node it names
	 */
	complete(bound: IBound): IBound {
		if (!bound.key || bound.node) return bound;
		const node = this.node(bound.key);
		return node ? { key: bound.key, node } : { error: { code: 'SOURCE_MISSING', message: `The installed graph names "${bound.key}" and does not describe it` } };
	}

	/**
	 * The registry the host addresses an instance under, or why it has none
	 */
	async origin(node: IServedNode): Promise<{ registry?: string; reason?: string }> {
		return (await this.#delivery.origin?.(node.name, node.version)) ?? { registry: 'npm' };
	}

	/**
	 * Whether an installed instance publishes a subpath literally, as its `exports` say where it is installed
	 */
	async exports(node: IServedNode, subpath: string): Promise<boolean> {
		try {
			const { exports } = JSON.parse(await fs.readFile(join(node.location, 'package.json'), 'utf8'));
			return !!exports && typeof exports === 'object' && Object.prototype.hasOwnProperty.call(exports, subpath);
		} catch {
			return false;
		}
	}
}
