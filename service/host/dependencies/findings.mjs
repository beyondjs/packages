// Packages a page can hold only one release of: two of them in one page break it (hooks, the runtime registry)
const SINGLETONS = Object.freeze(['react', 'react-dom', 'preact', 'vue', 'svelte', 'solid-js', '@beyond-js/kernel', '@beyond-js/widgets', '@beyond-js/local-2026']);

// What each code of the resolution is about
const KINDS = Object.freeze({
	VERSION_UNRESOLVED: 'version',
	RELEASE_NOT_FOUND: 'version',
	PACKAGE_NOT_FOUND: 'source',
	PACKAGE_VERSIONS_FAILED: 'source',
	PROVIDER_AUTH_REQUIRED: 'source',
	PROVIDER_AUTH_DENIED: 'source',
	NETWORK_ERROR: 'source',
	INVALID_PROVIDER_RESPONSE: 'source',
	SOURCE_UNSUPPORTED: 'source',
	RELEASE_DIST_MISSING: 'integrity',
	WORKSPACE_PACKAGE_NOT_FOUND: 'source',
	WORKSPACE_RANGE_UNSATISFIED: 'version',
	PEER_INCOMPATIBLE: 'peer',
	PEER_MISSING: 'peer',
	PEER_PROVIDER_FAILED: 'peer',
	PEER_CONTEXT_CONFLICT: 'peer',
	INSTANCE_NAME_CONFLICT: 'singleton'
});

/**
 * The findings of a plan, each `{code, message, severity, kind, …}` with `kind` one of `version`, `source`, `peer`,
 * `singleton`, `integrity`, `manifest`, `graph` or `resolution`:
 *
 * - every diagnostic of the plan's resolution, classified;
 * - a requested version that is not published (`VERSION_NOT_FOUND`) or that the graph did not select
 *   (`VERSION_NOT_ADMITTED`: no declared range admits it, or a peer requirement pulled the selection back);
 * - a package a page holds once found in two releases in one importer's page (`SINGLETON_DUPLICATED`, a warning, with
 *   whether the current graph already had it);
 * - a release whose integrity changed under the same key (`INTEGRITY_MISMATCH`);
 * - the manifests the plan cannot edit (`MANIFEST_INVALID`, `MANIFEST_OUTSIDE_ROOT`).
 *
 * `contexts` lists the names the proposed graph holds in several releases, with the importers whose pages reach each
 * one: several versions in a workspace are allowed, one page with two of a singleton is not.
 */
export class Findings {
	#list = [];
	#contexts = [];

	/**
	 * @param {{resolution: object, draft: import('./draft.mjs').Draft, current: import('./graph.mjs').Graph, proposed:
	 * import('./graph.mjs').Graph, comparison: import('./comparison.mjs').Comparison}} inputs
	 */
	constructor({ resolution, draft, current, proposed, comparison }) {
		for (const { code, message, severity, node } of resolution.diagnostics ?? []) {
			this.#list.push({ code, message, severity, kind: code === 'GRAPH_INCOMPLETE' ? 'graph' : KINDS[code] ?? 'resolution', ...(node ? { node } : {}) });
		}
		this.#list.push(...draft.diagnostics);
		// Without a graph there is nothing to say about versions, pages or integrity: the resolution's failure is all
		if (!resolution.graph) return;
		this.#versions(draft.pins, proposed, resolution.releases ?? []);
		this.#singletons(current, proposed);
		for (const { key, before, after } of comparison.integrity) {
			const message = `${key} was recorded with the integrity ${before}, and its registry now publishes ${after}: a published release does not change`;
			this.#list.push({ code: 'INTEGRITY_MISMATCH', message, severity: 'error', kind: 'integrity', node: key });
		}
	}

	get list() {
		return this.#list;
	}

	get contexts() {
		return this.#contexts;
	}

	/**
	 * Whether no finding is an error
	 */
	get valid() {
		return !this.#list.some(({ severity }) => severity === 'error');
	}

	#versions(pins, proposed, releases) {
		for (const { name, version } of pins) {
			if (proposed.keys(name).some(key => proposed.node(key)?.version === version)) continue;
			const published = releases.find(one => one.name === name);
			if (published?.found && !published.versions.includes(version)) {
				const message = `${name}@${version} is not published by ${published.registry ?? 'its registry'}; the newest is ${published.versions[0] ?? 'none'}`;
				this.#list.push({ code: 'VERSION_NOT_FOUND', message, severity: 'error', kind: 'version', name, version });
				continue;
			}
			const message = `${name}@${version} was not selected: no declared range admits it, or a peer requirement keeps another release; give a range that admits it`;
			this.#list.push({ code: 'VERSION_NOT_ADMITTED', message, severity: 'error', kind: 'version', name, version });
		}
	}

	/**
	 * The releases of each singleton one importer's page reaches, in a graph
	 */
	static #pages(graph) {
		const found = [];
		for (const id of Object.keys(graph.members)) {
			const page = graph.page(id);
			const by = new Map();
			for (const key of page) {
				const node = graph.node(key);
				if (!SINGLETONS.includes(node?.name) || key.startsWith('workspace:')) continue;
				by.set(node.name, [...(by.get(node.name) ?? []), node.version]);
			}
			for (const [name, versions] of by) versions.length > 1 && found.push({ importer: id, name, versions: [...new Set(versions)].sort() });
		}
		return found;
	}

	#singletons(current, proposed) {
		const before = new Set(Findings.#pages(current).map(({ importer, name }) => `${importer}\u0000${name}`));
		for (const { importer, name, versions } of Findings.#pages(proposed)) {
			const introduced = !before.has(`${importer}\u0000${name}`);
			const message = `A page of ${importer} would load ${name} in ${versions.length} releases (${versions.join(', ')}), and it works with one`;
			this.#list.push({ code: 'SINGLETON_DUPLICATED', message, severity: 'warning', kind: 'singleton', importer, name, versions, introduced });
		}

		const names = new Map();
		for (const [key, node] of proposed.nodes) {
			if (key.startsWith('workspace:') || typeof node?.name !== 'string') continue;
			names.set(node.name, [...(names.get(node.name) ?? []), key]);
		}
		const pages = Object.keys(proposed.members).map(id => [id, proposed.page(id)]);
		for (const [name, keys] of names) {
			if (keys.length < 2) continue;
			const nodes = keys.map(key => ({ key, version: proposed.node(key).version, importers: pages.filter(([, page]) => page.has(key)).map(([id]) => id) }));
			this.#contexts.push({ name, nodes });
		}
	}
}
