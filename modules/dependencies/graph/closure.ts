import type { IDiagnostic } from '@beyond-js/packages/types';
import type { Node } from './node';

export /*bundle*/ interface IClosureFailure {
	// Occurrence that failed
	id: string;
	package: string;
	version: string;
	error: IDiagnostic;
}

/**
 * Judges a processed graph: a graph is valid only when nothing that is required failed.
 *
 * A failure is tolerated when every way to reach it goes through an optional dependency (or it is an
 * optional peer): it is recorded, and the closure stays valid without it. The same failure reached
 * through a required dependency is blocking, whichever occurrence happened to expand the release.
 */
export /*bundle*/ class Closure {
	#blocking: Map<string, IClosureFailure> = new Map();
	#tolerated: Map<string, IClosureFailure> = new Map();
	#visited: Set<string> = new Set();

	/**
	 * Failures that invalidate the closure
	 */
	get errors(): IClosureFailure[] {
		return [...this.#blocking.values()];
	}

	/**
	 * Failures of optional dependencies, without which the closure is still valid
	 */
	get tolerated(): IClosureFailure[] {
		return [...this.#tolerated.values()].filter(({ id }) => !this.#blocking.has(id));
	}

	get valid() {
		return !this.#blocking.size;
	}

	constructor(root: Node) {
		for (const node of root.dependencies.values()) this.#visit(node, false);
	}

	#record(node: Node, error: IDiagnostic, tolerant: boolean) {
		const failure = { id: node.id, package: node.package, version: node.version.specified, error };
		(tolerant ? this.#tolerated : this.#blocking).set(node.id, failure);
	}

	#visit(node: Node, tolerant: boolean) {
		tolerant = tolerant || node.optional;

		const key = `${node.id}|${tolerant}`;
		if (this.#visited.has(key)) return;
		this.#visited.add(key);

		// The failure of the occurrence that expands the release is a failure of every link to it
		const error = node.error || node.link?.error;
		if (error) return this.#record(node, error, tolerant);

		for (const child of node.dependencies.values()) this.#visit(child, tolerant);
		if (!node.link) return;

		// The release is expanded elsewhere: what it requires is required here too, in this context
		const expanded = `${node.link.id}|via|${tolerant}`;
		if (this.#visited.has(expanded)) return;
		this.#visited.add(expanded);
		for (const child of node.link.dependencies.values()) !child.soft && this.#expand(child, tolerant);
	}

	/**
	 * Visits what a linked release requires. Occurrences keep their own identity, the context is the
	 * one of the link.
	 */
	#expand(node: Node, tolerant: boolean) {
		tolerant = tolerant || node.optional;

		const key = `${node.id}|via|${tolerant}`;
		if (this.#visited.has(key)) return;
		this.#visited.add(key);

		const error = node.error || node.link?.error;
		if (error) return this.#record(node, error, tolerant);

		const target = node.link || node;
		for (const child of target.dependencies.values()) !child.soft && this.#expand(child, tolerant);
	}
}
