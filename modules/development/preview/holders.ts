/**
 * Who holds the stylesheets of the modules of a preview: the document, for a module the entry reaches without
 * crossing a widget, or the widgets that import it, which adopt its sheets in their own roots. It is decided from
 * the public dependencies of each module of the graph, by record (see `Records`).
 */
export class Holders {
	#edges: Map<string, Set<string>> = new Map();
	#widgets: Set<string> = new Set();

	/**
	 * Records that a module imports another one
	 */
	link(from: string, to: string): void {
		const targets = this.#edges.get(from) ?? new Set();
		this.#edges.set(from, targets.add(to));
	}

	/**
	 * Records that a module declares a widget: what it imports is held by the widget
	 */
	widget(id: string): void {
		this.#widgets.add(id);
	}

	/**
	 * The modules the roots reach without crossing a widget
	 */
	reached(roots: string[]): Set<string> {
		const reached = new Set<string>();
		const pending = [...roots];
		for (let id = pending.shift(); id; id = pending.shift()) {
			if (reached.has(id)) continue;
			reached.add(id);
			!this.#widgets.has(id) && pending.push(...(this.#edges.get(id) ?? []));
		}
		return reached;
	}
}
