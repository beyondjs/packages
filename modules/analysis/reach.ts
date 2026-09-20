import type { IItem } from './types';

/**
 * One reference between two items. `lazy` is a dynamic import; `declared` is a reference that only a
 * declaration states, not the code.
 */
export interface IEdge {
	target: string;
	lazy: boolean;
	declared: boolean;
}

/**
 * How the items of an inventory relate to the entries of the application: which targets need each one,
 * whether it loads eagerly, who references it and whether only a declaration reaches it.
 */
export /*bundle*/ class Reach {
	#items: Map<string, IItem>;
	#edges: Map<string, IEdge[]>;

	constructor(items: Map<string, IItem>, edges: Map<string, IEdge[]>) {
		this.#items = items;
		this.#edges = edges;
	}

	/**
	 * Every item reachable from the given ones through the edges a filter accepts
	 */
	#from(ids: string[], follow: (edge: IEdge) => boolean): Set<string> {
		const reached: Set<string> = new Set();
		const pending = ids.filter(id => this.#items.has(id));
		for (let id = pending.pop(); id; id = pending.pop()) {
			if (reached.has(id)) continue;
			reached.add(id);
			(this.#edges.get(id) ?? []).forEach(edge => follow(edge) && this.#items.has(edge.target) && pending.push(edge.target));
		}
		return reached;
	}

	relate(entries: { id: string; target: string }[]): void {
		const ids = entries.map(({ id }) => id);

		// Eager: static references alone lead to the item from an entry
		this.#from(ids, edge => !edge.lazy).forEach(id => (this.#items.get(id).loading = 'eager'));

		for (const target of [...new Set(entries.map(entry => entry.target))].sort()) {
			const from = entries.filter(entry => entry.target === target).map(({ id }) => id);
			this.#from(from, () => true).forEach(id => this.#items.get(id).targets.push(target));
		}

		// A module the code never names is in the inventory only because something declares it
		const coded = this.#from(ids, edge => !edge.declared);
		this.#items.forEach((item, id) => item.kind !== 'asset' && !coded.has(id) && (item.declared = true));

		const importers: Map<string, Set<string>> = new Map();
		this.#edges.forEach((edges, id) => {
			edges.forEach(({ target }) => this.#items.has(target) && this.#items.has(id) && importers.set(target, (importers.get(target) ?? new Set()).add(id)));
		});
		importers.forEach((set, id) => (this.#items.get(id).importers = [...set].sort()));
	}
}
