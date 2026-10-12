/**
 * The public surface a package archive offers its consumers: each public subpath, the file it resolves to, whether the
 * archive holds that file, and where its type declaration comes from.
 *
 * Subpaths are those of the manifest's `exports`, resolved for a Node consumer and, when that differs, a browser one,
 * with Packages' own reader of `exports` (`Exports` of `@beyond-js/packages/publication`, given by the feature). A
 * package that declares its Beyond public modules without `exports` lists the modules the workspace publishes for it.
 *
 * A declaration is, in order: the `types` condition of the subpath (or the root's `types`/`typings` field), which the
 * archive must hold (`package`); for a `source` package, the declaration Beyond generates from the module's sources
 * (`generated`, asked of the workspace, which a consumer that compiles the sources produces the same way); otherwise
 * none. Nothing is synthesized.
 *
 * | `types.state` | Meaning |
 * | --- | --- |
 * | `included` | The declaration the manifest names is in the archive |
 * | `excluded` | The manifest names a declaration that the archive leaves out |
 * | `generated` | No declaration in the archive; Beyond generates one from the sources |
 * | `absent` | None: `DECLARATION_NOT_FOUND`, or `DECLARATION_PRODUCER_MISSING` for a bundler without a `types` conditional |
 * | `invalid` | The sources do not check (`DECLARATION_INVALID`) |
 * | `unknown` | It was not produced within its bound (`DECLARATION_TIMEOUT`) |
 */
export class Surface {
	#manifest;
	#form;
	#files;
	#Exports;
	#declaration;
	#modules;

	/**
	 * @param {{manifest: object, form?: string, files: string[], Exports: Function, modules?: string[],
	 * declaration?: (subpath: string) => Promise<{state: string, code?: string}>}} specs The manifest, the publication
	 * form, the files the archive holds, Packages' `Exports` class, the subpaths of the Beyond public modules of the
	 * package when its manifest has no `exports`, and how a generated declaration is asked for
	 */
	constructor({ manifest, form, files, Exports, modules = [], declaration }) {
		this.#manifest = manifest;
		this.#form = form;
		this.#files = new Set(files);
		this.#Exports = Exports;
		this.#modules = modules;
		this.#declaration = declaration;
	}

	/**
	 * The entries of `exports`, keyed by subpath, as Node normalizes them; undefined without `exports`
	 */
	get #entries() {
		const { exports } = this.#manifest;
		if (exports === undefined || exports === null) return;
		if (typeof exports === 'string' || Array.isArray(exports)) return { '.': exports };
		const keys = Object.keys(exports);
		return keys.length && keys.every(key => !key.startsWith('.')) ? { '.': exports } : exports;
	}

	/**
	 * The first `types` condition of a target, depth first
	 */
	static #types(target) {
		if (!target || typeof target !== 'object') return;
		if (Array.isArray(target)) return target.map(Surface.#types).find(Boolean);
		for (const [condition, value] of Object.entries(target)) {
			if (condition === 'types' && typeof value === 'string') return value;
			const nested = Surface.#types(value);
			if (nested) return nested;
		}
	}

	#included(target) {
		return typeof target === 'string' ? this.#files.has(target.replace(/^\.\//, '')) : void 0;
	}

	/**
	 * @returns {string[]} The public subpaths
	 */
	get subpaths() {
		const entries = this.#entries;
		if (!entries && this.#modules.length) return [...new Set(this.#modules)].sort();
		return new this.#Exports(this.#manifest).subpaths;
	}

	/**
	 * Where a subpath's declaration comes from
	 */
	async #typed(subpath) {
		const entry = this.#entries?.[subpath];
		const root = subpath === '.' ? this.#manifest.types ?? this.#manifest.typings : void 0;
		const file = Surface.#types(entry) ?? (typeof root === 'string' ? root : void 0);
		if (file) return { state: this.#included(file) ? 'included' : 'excluded', provenance: 'package', file };
		if (this.#form === 'source' && this.#declaration) return this.#declaration(subpath);
		return { state: 'absent', code: 'DECLARATION_NOT_FOUND' };
	}

	/**
	 * Every public subpath with how it is declared (`exports`, `main` for a package without `exports`, or `module` for
	 * a Beyond public module its module manifest declares, whose entry a consumer compiles), its targets for a Node and
	 * a browser consumer, whether the archive holds them, and its declaration
	 *
	 * @returns {Promise<{subpath: string, declared: string, target?: string, included?: boolean, browser?: {target:
	 * string, included: boolean}, types: object, diagnostics?: object[]}[]>}
	 */
	async list() {
		const listed = [];
		const entries = this.#entries;
		if (!entries && this.#modules.length) {
			for (const subpath of this.subpaths) listed.push({ subpath, declared: 'module', types: await this.#typed(subpath) });
			return listed;
		}

		const exports = new this.#Exports(this.#manifest);
		for (const subpath of this.subpaths) {
			const node = exports.resolve(subpath, 'node');
			const browser = exports.resolve(subpath, 'browser');
			const target = node.target ?? browser.target;
			const other = browser.target && browser.target !== target ? { browser: { target: browser.target, included: this.#included(browser.target) } } : {};
			listed.push({
				subpath,
				declared: entries ? 'exports' : 'main',
				...(target !== undefined ? { target, included: this.#included(target) } : {}),
				...other,
				types: await this.#typed(subpath),
				...(node.diagnostics.length ? { diagnostics: [...node.diagnostics] } : {})
			});
		}
		return listed;
	}
}
