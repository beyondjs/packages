import type { DependenciesGraph } from '@beyond-js/packages/dependencies/graph';
import type { IWorkspaceGraph, IWorkspaceImporter } from './types';
import type { WorkspaceRoot } from './root';
import { Canonical } from '../canonical';
import { Traversal } from '../traversal';

/**
 * Writes the processed graph of a workspace as a `beyond-workspace-graph/1` document: its importers by member id,
 * every node they reach and the edges of each one, in canonical order so that the digest only depends on what
 * was resolved.
 *
 * A page registers a package by its name and version: two nodes with the same name and version (a registry copy
 * of a member reached through an alias, one release from two registries) are `INSTANCE_NAME_CONFLICT`.
 */
export class WorkspaceDocument {
	#graph: DependenciesGraph;
	#traversal: Traversal;
	#members: Record<string, IWorkspaceImporter> = {};

	constructor(graph: DependenciesGraph, root: WorkspaceRoot) {
		this.#graph = graph;
		const traversal = (this.#traversal = new Traversal(graph));
		root.members.diagnostics.forEach(diagnostic => traversal.diagnose(diagnostic));

		const importers = root.members.importers.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
		for (const { id, name, version } of importers) {
			const node = graph.dependencies.get(`workspace:${id}`);
			const key = node && traversal.releases.key(node);
			if (key) this.#members[id] = { name, version, node: key };
		}

		this.#conflicts();
	}

	#conflicts() {
		const instances: Map<string, string[]> = new Map();
		for (const [key, { name, version }] of Object.entries(this.#traversal.releases.sorted)) {
			const instance = `${name}@${version}`;
			instances.set(instance, [...(instances.get(instance) || []), key]);
		}

		for (const [instance, keys] of instances) {
			if (keys.length < 2) continue;
			const message =
				`"${instance}" is provided by ${keys.length} nodes (${keys.join(', ')}): a page registers a package ` +
				`by its name and version, and could not tell them apart`;
			this.#traversal.diagnose({ code: 'INSTANCE_NAME_CONFLICT', message, severity: 'error' });
		}
	}

	/**
	 * The document, with the digest of its canonical form
	 */
	write(): IWorkspaceGraph {
		const traversal = this.#traversal;
		const content = {
			protocol: <const>'beyond-workspace-graph/1',
			members: this.#members,
			nodes: traversal.releases.sorted,
			edges: traversal.edges,
			overrides: traversal.overrides(this.#graph),
			exceptions: traversal.exceptions,
			diagnostics: traversal.diagnostics
		};
		// Plain data only: a member without value is absent, not undefined
		const plain = JSON.parse(JSON.stringify(content));
		return { ...plain, digest: Canonical.digest(plain) };
	}
}
