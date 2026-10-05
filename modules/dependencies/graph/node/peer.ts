import type { IDiagnostic } from '@beyond-js/packages/types';
import type { Node } from '.';
import { DependencySourceIsType } from '@beyond-js/packages/dependency-source';

/**
 * A peer requirement and who provides it. A peer is not installed by the package that declares it: it is
 * the release that the dependents of that package already use. The search goes from the direct
 * dependent of the declaring package up to the root, and the first one that depends on the peer (or is
 * the peer) provides it.
 */
export class Peer {
	#node: Node;
	#optional: boolean;

	#provider?: Node;
	/**
	 * The occurrence that provides the peer
	 */
	get provider() {
		return this.#provider;
	}

	#context?: Node;
	/**
	 * The dependent in whose context the peer was provided
	 */
	get context() {
		return this.#context;
	}

	/**
	 * @param node The peer requirement: an occurrence of kind 'peer' below the package that declares it
	 * @param optional True when the declaring package works without the peer
	 */
	constructor(node: Node, optional: boolean) {
		this.#node = node;
		this.#optional = optional;
	}

	/**
	 * Looks for the provider among the dependents. Every sibling occurrence exists by now, because the
	 * dependencies of a package are all created before any of them is expanded.
	 */
	bind() {
		const node = this.#node;
		const name = node.package;
		this.#provider = this.#context = void 0;

		for (let context = node.parent?.parent; context; context = context.parent) {
			const candidate = context.dependencies.get(name);
			if (candidate && candidate !== node.parent) {
				// A dependent that only requires the peer itself passes on whoever provides it
				const provider = candidate.soft ? candidate.provider : candidate;
				if (provider) return this.#found(provider, context);
			}

			// The dependent may be the peer itself, as a plugin below its host
			if (context.parent && context.package === name) return this.#found(context, context);
		}
	}

	/**
	 * Binds the requirement to its provider and takes the release of the provider. The required range
	 * constrains the group of a provider of the same package, from a registry or from the workspace.
	 */
	async register(update: boolean) {
		this.bind();
		const node = this.#node;
		const provider = this.#provider;
		if (!provider) return;

		// Only a provider of the same package can be constrained by the required range
		const same = provider.source?.id === node.source.id;
		const { is } = node.source.data;
		if (same && (is === DependencySourceIsType.Semver || is === DependencySourceIsType.Workspace)) {
			await node.registry.nodes.register(node, update);
		}
		!node.version.error && node.version.update({ version: provider.version.resolved });
	}

	#found(provider: Node, context: Node) {
		this.#provider = provider;
		this.#context = context;
	}

	#describe(): string {
		const { parent, package: name, version } = this.#node;
		return `"${parent.package}@${parent.version.resolved}" requires the peer "${name}@${version.specified}"`;
	}

	#failed(): IDiagnostic {
		const cause = this.#provider.version.error?.code || this.#provider.error?.code;
		const message = `The provider of the peer "${this.#node.package}" failed: ${cause}`;
		return { code: 'PEER_PROVIDER_FAILED', message };
	}

	/**
	 * What is wrong with the requirement when its occurrence is processed: nobody provides it
	 */
	evaluate(): IDiagnostic | undefined {
		if (this.#provider) return this.#provider.version.error ? this.#failed() : void 0;
		if (this.#optional) return;

		const message = `${this.#describe()}, which none of its dependents provides`;
		return { code: 'PEER_MISSING', message };
	}

	/**
	 * What is wrong with the requirement when the pass ends and the release of the provider is known
	 *
	 * @param met Whether that release satisfies the required range
	 */
	conclude(met: boolean): IDiagnostic | undefined {
		if (met || !this.#provider) return;
		if (this.#provider.version.error) return this.#failed();

		const provided = `"${this.#node.package}@${this.#provider.version.resolved}"`;
		const message = `${this.#describe()}, but ${provided} is what its dependents provide`;
		return { code: 'PEER_INCOMPATIBLE', message };
	}
}
