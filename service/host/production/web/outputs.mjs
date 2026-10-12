import { ResourcePath } from '@beyond-js/artifact-api';
import { Rules } from '../../exports/rules.mjs';
import { Addresses } from './addresses.mjs';

/**
 * The production outputs a web page needs, found by walking its graph from the entry module with the production output
 * of each module.
 *
 * Where each import goes is decided by the page's description (the preview's description of the entry, given by
 * `WebExport` for the strategy): its import map, with the scope of an importer that reaches another version, is followed
 * as a browser follows it. An import the map gives this environment is compiled for production (`{platform: 'web',
 * environment: 'production'}`): a module that builds no production conditional is `EXPORT_PRODUCTION_UNAVAILABLE`, never
 * replaced by its development output. What a module imports (its runtime, its public dependencies, the stylesheets it
 * selects by specifier) is walked in turn, its own stylesheet is taken with it, and the declared assets its code or its
 * stylesheet addresses relative to itself (`../assets/…`) are read from its package, a file named like a secret never.
 * An import the map gives the CDN is referenced, not walked (`cdn` strategy), and is `EXPORT_REMOTE_REFUSED` in a
 * self-contained export. An import without an address, or one the description maps to a module that throws its reason,
 * is `EXPORT_UNRESOLVED`. The development coordinator a preview registers is not walked: nothing the entry imports
 * reaches it, so no update connection enters the export.
 *
 * ```js
 * const outputs = await new Outputs({ delivery, description, addresses, remote: false }).walk(step, signal);
 * outputs.files;        // [{path, file, kind, content, module?}]
 * outputs.importmap;    // {imports, scopes?, integrity?} with the export's addresses
 * outputs.links;        // the stylesheets the document links
 * outputs.diagnostics;  // empty when every output was produced
 * ```
 */
export class Outputs {
	static PRODUCTION = Object.freeze({ platform: 'web', environment: 'production' });
	static #CODE = /["'`]((?:\.\.\/)+assets\/[^"'`?#\s]+)/g;
	static #SHEET = /url\(\s*(['"]?)((?:\.\.\/)+assets\/[^'")?#\s]+)\1\s*\)/g;

	#delivery;
	#description;
	#addresses;
	#remote;
	#files = new Map();
	#failed = new Set();
	#cdn = new Map();
	#diagnostics = [];

	/**
	 * @param {{delivery: {module: Function, resources: {styles: Function, asset: Function}}, description: object,
	 * addresses: Addresses, remote: boolean}} specs The hosted workspace that compiles, the page's description, the
	 * addresses of the export, and whether imports may stay on the CDN
	 */
	constructor({ delivery, description, addresses, remote }) {
		this.#delivery = delivery;
		this.#description = description;
		this.#addresses = addresses;
		this.#remote = remote;
	}

	get files() {
		return [...this.#files.entries()].map(([path, file]) => ({ path, ...file }));
	}

	get diagnostics() {
		return [...this.#diagnostics];
	}

	/**
	 * The CDN references the walk reached, as `{specifier, url, integrity?}`
	 */
	get cdn() {
		const { integrity = {} } = this.#description.importmap;
		return [...this.#cdn].map(([url, specifier]) => ({ specifier, url, ...(integrity[url] ? { integrity: integrity[url] } : {}) }));
	}

	#report(code, message) {
		!this.#diagnostics.some(one => one.code === code && one.message === message) && this.#diagnostics.push({ code, message });
	}

	/**
	 * The address an importer reaches a specifier at: the longest scope of the importer that maps it, else the import
	 */
	#resolve(specifier, importer) {
		const { imports, scopes = {} } = this.#description.importmap;
		const prefixes = importer ? Object.keys(scopes).filter(prefix => importer.startsWith(prefix)).sort((a, b) => b.length - a.length) : [];
		for (const prefix of prefixes) if (scopes[prefix][specifier] !== undefined) return scopes[prefix][specifier];
		return imports[specifier];
	}

	/**
	 * Why an import has no address: the reason of the module's record, or the module the description maps it to
	 */
	#unresolved(specifier, importer, url) {
		const record = this.#description.modules.find(module => module.specifier === specifier && module.source === 'unresolved');
		const thrown = url?.startsWith('data:') ? /Error\("(.*)"\)/.exec(decodeURIComponent(url))?.[1] : void 0;
		const reason = record?.reason ?? thrown ?? 'the page has no address for it';
		const from = importer ? `, imported by ${Addresses.path(importer) ?? importer}` : '';
		this.#report('EXPORT_UNRESOLVED', `"${specifier}"${from}: ${reason}`);
	}

	/**
	 * @param {{count(done: number, total?: number, unit?: string): object, current(text?: string): object}} [step]
	 * @param {AbortSignal} [signal] Stops the walk between two outputs, with the signal's reason
	 * @returns {Promise<Outputs>}
	 */
	async walk(step, signal) {
		const queue = [{ specifier: this.#description.entry.specifier }];
		let done = 0;
		while (queue.length) {
			if (signal?.aborted) throw signal.reason;
			const { specifier, importer } = queue.shift();
			const url = this.#resolve(specifier, importer);
			if (url === undefined || url.startsWith('data:')) {
				this.#unresolved(specifier, importer, url);
				continue;
			}
			if (Addresses.remote(url)) {
				this.#remote ? this.#cdn.set(url, specifier) : this.#report('EXPORT_REMOTE_REFUSED', `"${specifier}" is on another origin (${url.split('?')[0]}), which a self-contained export does not reference`);
				continue;
			}
			const path = Addresses.path(url);
			if (!path) {
				this.#unresolved(specifier, importer, url);
				continue;
			}
			if (this.#files.has(path) || this.#failed.has(path)) continue;

			step?.count(done, done + queue.length + 1, 'outputs').current(specifier);
			const resource = Addresses.resource(path);
			if (resource.kind === 'style') await this.#style(path, resource.identity, specifier);
			else if (resource.kind === 'module') await this.#module(path, resource.identity, url, queue, specifier);
			else this.#report('EXPORT_UNRESOLVED', `"${specifier}" maps to ${path}, which is not a module or a stylesheet`);
			done++;
		}
		step?.count(done, done, 'outputs').current();
		return this;
	}

	static #production(key) {
		return key === 'installed' || String(key).endsWith('/production');
	}

	#failure(path, specifier, failure) {
		this.#failed.add(path);
		const diagnostics = failure.diagnostics?.length ? failure.diagnostics : [failure];
		diagnostics.forEach(({ code, message }) => this.#report(code === 'OUTPUT_NOT_AVAILABLE' ? 'EXPORT_PRODUCTION_UNAVAILABLE' : code, `${specifier}: ${message}`));
	}

	async #module(path, identity, url, queue, specifier) {
		const { name, version, subpath } = identity;
		const { delivered, failure } = await this.#delivery.module({ name, version, subpath }, Outputs.PRODUCTION);
		if (!delivered) return this.#failure(path, specifier, failure);
		if (!Outputs.#production(delivered.key)) {
			this.#failed.add(path);
			return this.#report('EXPORT_PRODUCTION_UNAVAILABLE', `${specifier}: its bundler builds no production output (it builds "${delivered.key}")`);
		}

		const content = delivered.code('none');
		this.#files.set(path, { file: Addresses.file(path, 'module'), kind: 'module', content, module: delivered.vspecifier });
		if (delivered.styles) await this.#style(ResourcePath.format({ kind: 'style', identity }), identity, `${specifier}.css`);
		const dependencies = [...(delivered.runtime ? [{ specifier: delivered.runtime }] : []), ...(delivered.dependencies ?? []).filter(({ source }) => source !== 'builtin')];
		dependencies.forEach(dependency => queue.push({ specifier: dependency.specifier, importer: url }));
		(delivered.stylesheets ?? []).forEach(sheet => queue.push({ specifier: sheet, importer: url }));
		await this.#assets(path, content, Outputs.#CODE, 1, identity);
	}

	async #style(path, identity, specifier) {
		if (this.#files.has(path) || this.#failed.has(path)) return;
		const { name, version, subpath } = identity;
		const { styles, key, failure } = await this.#delivery.resources.styles({ name, version, subpath }, Outputs.PRODUCTION);
		if (failure) return this.#failure(path, specifier, failure);
		if (!Outputs.#production(key)) {
			this.#failed.add(path);
			return this.#report('EXPORT_PRODUCTION_UNAVAILABLE', `${specifier}: its bundler builds no production stylesheet (it builds "${key}")`);
		}
		const content = styles.code();
		this.#files.set(path, { file: Addresses.file(path, 'style'), kind: 'style', content });
		await this.#assets(path, content, Outputs.#SHEET, 2, identity);
	}

	/**
	 * The declared assets a module or a stylesheet addresses relative to itself
	 */
	async #assets(path, text, pattern, group, identity) {
		for (const match of text.matchAll(pattern)) {
			const resolved = new URL(match[group], `http://export${path}`).pathname;
			if (this.#files.has(resolved) || this.#failed.has(resolved)) continue;
			let resource;
			try {
				resource = Addresses.resource(resolved);
			} catch {
				continue;
			}
			if (resource.kind !== 'asset' || resource.identity.name !== identity.name || resource.identity.version !== identity.version) continue;
			if (Rules.secret(resource.path.split('/').at(-1))) {
				this.#failed.add(resolved);
				this.#report('EXPORT_SECRET_REFUSED', `${identity.name}@${identity.version}: "${resource.path}" is named like a secret and is never exported`);
				continue;
			}
			const { content, failure } = await this.#delivery.resources.asset({ name: identity.name, version: identity.version, path: resource.path });
			if (failure) {
				this.#failure(resolved, `${identity.name}@${identity.version}/${resource.path}`, failure);
				continue;
			}
			this.#files.set(resolved, { file: Addresses.file(resolved, 'asset'), kind: 'asset', content });
		}
	}

	/**
	 * An address of the description in the export: this environment's resources that were exported, the CDN's as they
	 * are when the export references the CDN; anything else is left out
	 */
	#rewrite(url) {
		if (Addresses.remote(url)) return this.#remote ? url : void 0;
		const path = Addresses.path(url);
		const exported = path && this.#files.get(path);
		return exported ? this.#addresses.address(path, exported.kind) : void 0;
	}

	/**
	 * The import map of the exported page: the description's, with the export's addresses
	 */
	get importmap() {
		const { imports, scopes = {}, integrity = {} } = this.#description.importmap;
		const entries = values => Object.fromEntries(Object.entries(values).map(([key, url]) => [key, this.#rewrite(url)]).filter(([, url]) => url !== undefined));
		const map = { imports: entries(imports) };
		for (const [prefix, scope] of Object.entries(scopes)) {
			const kept = entries(scope);
			Object.keys(kept).length && ((map.scopes ??= {})[this.#addresses.scope(prefix)] = kept);
		}
		const used = new Set([...Object.values(map.imports), ...Object.values(map.scopes ?? {}).flatMap(scope => Object.values(scope))]);
		const pinned = Object.fromEntries(Object.entries(integrity).filter(([url]) => used.has(url)));
		Object.keys(pinned).length && (map.integrity = pinned);
		return map;
	}

	/**
	 * The stylesheets the document links, as the preview's document links them: those of the modules the entry reaches
	 * without crossing a widget, and the ones they select by specifier, each once, with its integrity on the CDN
	 */
	get links() {
		const { modules, importmap } = this.#description;
		const held = modules.filter(module => !module.widget && module.scope !== 'widget');
		const sheets = held.flatMap(module => [
			...(module.styles ? [{ module: module.vspecifier ?? module.specifier, url: module.styles }] : []),
			...(module.stylesheets ?? []).map(({ vspecifier, url }) => ({ module: vspecifier, url }))
		]);
		const links = new Map();
		for (const { module, url } of sheets) {
			const href = this.#rewrite(url);
			href && !links.has(href) && links.set(href, { href, module, ...(importmap.integrity?.[url] ? { integrity: importmap.integrity[url] } : {}) });
		}
		return [...links.values()];
	}
}
