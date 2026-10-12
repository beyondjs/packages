/**
 * Stand-ins for the public modules of Packages that the production feature loads, for the cases that run without the
 * loader of a service (`service/test/production.routes.test.mjs`). They answer the shapes the fixtures use, and only
 * those: the real readers (`Publication`, `Exports` of `@beyond-js/packages/publication`, `ProvidersSettings`) are
 * exercised by `tests/production` through a real service.
 *
 * - `Publication.read(manifest)`: the form `beyond.publication` declares, else `npm`.
 * - `Exports`: the subpaths of `exports` (a string or an object of subpaths), each resolved through `node`/`browser`,
 *   `import` and `default` conditions; without `exports`, `main` for the root.
 * - `settings(registry)`: npm's configuration naming one registry for every package and no credential.
 */
export class Publication {
	static read(manifest) {
		const declared = manifest?.beyond?.publication;
		if (declared) return { form: declared.form, protocol: declared.protocol, version: manifest.version, diagnostics: [] };
		return { form: 'npm', version: manifest.version, diagnostics: [] };
	}
}

export class Exports {
	#manifest;

	constructor(manifest) {
		this.#manifest = manifest ?? {};
	}

	get #entries() {
		const { exports } = this.#manifest;
		if (exports === undefined) return;
		return typeof exports === 'string' ? { '.': exports } : exports;
	}

	get subpaths() {
		return this.#entries ? Object.keys(this.#entries).filter(key => key.startsWith('.')) : ['.'];
	}

	resolve(subpath, platform) {
		const entries = this.#entries;
		if (!entries) return { target: subpath === '.' ? `./${String(this.#manifest.main ?? 'index.js').replace(/^\.\//, '')}` : subpath, via: ['main'], diagnostics: [] };
		const value = entries[subpath];
		const target = typeof value === 'string' ? value : value?.[platform === 'node' ? 'node' : 'browser'] ?? value?.import ?? value?.default;
		if (typeof target === 'string') return { target, via: [], diagnostics: [] };
		return { via: [], diagnostics: [{ code: 'EXPORT_NOT_FOUND', message: `Package "${this.#manifest.name}" does not export "${subpath}"` }] };
	}
}

/**
 * The provider settings of a workspace whose configuration names one registry
 *
 * @param {string} registry
 */
export const settings = registry => async () => ({
	get: ({ hostname, base }) => (hostname ? { base, auth: { mode: 'none' } } : { base: registry, origin: 'project-rc', auth: { mode: 'none' } })
});
