import type { IPublishedModule } from '../builds';
import type { Preview } from '../preview';
import { Redaction } from '../preview/redaction';
import type { ICompositionDocument } from '../preview/types';
import type { ICompositionSummary } from './types';

/**
 * The composition of a target's graph by source, read from the existing composition document
 * (`beyond-dev-composition/1`) of its entry: the public modules its entry reaches on its platform (the page of a
 * frontend target, the Node consumer of a backend one) by where their output comes from (`workspace`, `environment`,
 * `cdn`, `unresolved`), and their packages by the source their outputs share (`mixed` when they differ). It describes
 * and decides nothing: the selection, the externals policy and the CDN's answers are the composition document's.
 */
export class Summary {
	#preview: Preview;

	constructor(preview: Preview) {
		this.#preview = preview;
	}

	/**
	 * @param requested The specifier the composition document is asked for: the versioned one when several local
	 * versions publish the entry
	 */
	async read(requested: string, module: IPublishedModule, platform: 'web' | 'node'): Promise<ICompositionSummary> {
		let document: ICompositionDocument;
		try {
			document = await this.#preview.composition(requested);
		} catch (error) {
			return { packages: {}, modules: {}, reason: Redaction.text((<Error>error).message) };
		}

		const entry = document.modules.find(one => one.vspecifier === module.vspecifier);
		if (!entry) return { packages: {}, modules: {}, reason: `The composition of "${requested}" does not describe its entry` };

		// What the entry reaches on its platform, by the public dependencies of the document
		const reached = new Set([entry.id]);
		const queue = [entry.id];
		for (let id = queue.shift(); id; id = queue.shift()) {
			for (const edge of document.edges) {
				if (edge.platform !== platform || edge.from !== id || reached.has(edge.to)) continue;
				reached.add(edge.to);
				queue.push(edge.to);
			}
		}

		// A package's source is the one its reached modules share on this platform, or `mixed`
		const modules: Record<string, number> = {};
		const sources = new Map<string, Set<string>>();
		for (const one of document.modules) {
			const output = one.outputs[platform];
			if (!reached.has(one.id) || !output) continue;
			modules[output.source] = (modules[output.source] ?? 0) + 1;
			sources.set(one.package, (sources.get(one.package) ?? new Set()).add(output.source));
		}

		const packages: Record<string, number> = {};
		for (const found of sources.values()) {
			const source = found.size === 1 ? [...found][0] : 'mixed';
			packages[source] = (packages[source] ?? 0) + 1;
		}
		return { packages, modules };
	}
}
