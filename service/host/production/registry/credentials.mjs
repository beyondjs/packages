/**
 * The registry a package is published to, and the credentials of this machine for a registry, read as npm reads its
 * configuration: the package's `publishConfig.registry` first, then the project, workspace, user and global rc files
 * and the environment (`NPM_REGISTRY`, `NPM_TOKEN`, scopes), through Packages' own `ProvidersSettings`
 * (`@beyond-js/packages/providers/settings`), which the installation of the workspace uses too. The configuration is
 * read again at every call, so a login since the service started counts.
 *
 * A credential never leaves this object except as the `Authorization` header of a request to the registry it belongs
 * to: it is never written to a record, an event, a log or an answer.
 *
 * ```js
 * const credentials = new Credentials({ root, load: options => settings(options) });
 * const { url, source } = await credentials.registry(manifest, directory);   // source: publishConfig | configuration | default
 * const authorization = await credentials.authorization(url);                // 'Bearer …', 'Basic …' or undefined
 * ```
 */
export class Credentials {
	#root;
	#environment;
	#load;

	/**
	 * @param {{root: string, environment?: Record<string, string | undefined>, load: (options: object) =>
	 * Promise<{get(query: object): {base: string, origin: string, auth: {mode: string, token?: string, user?: string}}}>}}
	 * options The root of the workspace, the environment the configuration is read from, and how the provider settings
	 * are created and loaded for a package directory
	 */
	constructor({ root, environment = process.env, load }) {
		this.#root = root;
		this.#environment = environment;
		this.#load = load;
	}

	/**
	 * A registry address without its trailing slash, or undefined when it is not an http or https address
	 *
	 * @param {unknown} value
	 */
	static normalized(value) {
		if (typeof value !== 'string' || !URL.canParse(value)) return;
		const url = new URL(value);
		if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) return;
		return `${url.origin}${url.pathname}`.replace(/\/+$/, '');
	}

	async #settings(directory = this.#root) {
		const user = this.#environment.npm_config_userconfig || this.#environment.NPM_CONFIG_USERCONFIG;
		return this.#load({ path: directory, workspace: this.#root, env: { ...this.#environment }, ...(user ? { user } : {}) });
	}

	/**
	 * The registry a package goes to
	 *
	 * @param {{name: string, publishConfig?: {registry?: string}}} manifest
	 * @param {string} [directory] The package's directory, whose rc file applies first
	 * @returns {Promise<{url: string, source: 'publishConfig' | 'configuration' | 'default'}>}
	 */
	async registry(manifest, directory) {
		const declared = Credentials.normalized(manifest.publishConfig?.registry);
		if (declared) return { url: declared, source: 'publishConfig' };
		const settings = await this.#settings(directory);
		const { base, origin } = settings.get({ package: manifest.name });
		return { url: base.replace(/\/+$/, ''), source: origin === 'default' ? 'default' : 'configuration' };
	}

	/**
	 * The `Authorization` header this machine presents to a registry, or undefined when it has no credential for it
	 *
	 * @param {string} url
	 * @param {string} [directory]
	 */
	async authorization(url, directory) {
		const settings = await this.#settings(directory);
		const { auth } = settings.get({ hostname: new URL(url).host, base: url });
		if (!auth?.token) return;
		if (auth.mode === 'token') return `Bearer ${auth.token}`;
		if (auth.mode === 'basic') return `Basic ${auth.token}`;
		if (auth.mode === 'user-pass' && auth.user) return `Basic ${Buffer.from(`${auth.user}:${auth.token}`).toString('base64')}`;
	}
}
