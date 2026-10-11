/**
 * The origins a service that pairs browsers knows: its own, for each of its two listeners, and the configured ones.
 *
 * - Interface origins, which pair and read the API listener: the API listener's own origins (its loopback names with
 *   its port, and its public origin), where the fallback interface runs, and the configured Packages interfaces.
 * - Origins that read the preview listener's compiled modules: its own origins, the interface origins and the
 *   configured embed origins, pages that import a widget served here.
 *
 * The preview listener's own origins are never interface origins: code that runs in a preview cannot pair.
 *
 * ```js
 * const origins = new Origins({ interfaces: ['https://packages.example'], embeds: ['https://site.example'] });
 * origins.listen({ api: 4000, preview: 4001, publics: {} });
 * origins.interface('http://127.0.0.1:4000');   // true
 * origins.interface('http://127.0.0.1:4001');   // false: the preview
 * ```
 */
export class Origins {
	static #NAMES = ['127.0.0.1', 'localhost', '[::1]'];

	#configured;
	#embeds;
	#api = new Set();
	#preview = new Set();

	/**
	 * @param {{interfaces?: string[], embeds?: string[]}} configured
	 * @throws {Error} For a value that is not an http or https origin, which fails the start of the service
	 */
	constructor({ interfaces = [], embeds = [] } = {}) {
		this.#configured = new Set(Origins.#validated(interfaces, 'interface'));
		this.#embeds = new Set(Origins.#validated(embeds, 'embed'));
	}

	static #validated(values, what) {
		if (!Array.isArray(values)) throw new Error(`The ${what} origins of the pairing setting must be a list of origins`);
		return values.map(value => {
			let url;
			try {
				url = new URL(value);
			} catch {
				throw new Error(`The ${what} origin "${value}" is not an origin`);
			}
			if (!['http:', 'https:'].includes(url.protocol)) throw new Error(`The ${what} origin "${value}" is not an http or https origin`);
			return url.origin;
		});
	}

	/**
	 * The listeners listen: their own origins are their loopback names with their ports, and their public origins
	 *
	 * @param {{api: number, preview: number, publics?: {api?: string, preview?: string}}} listening
	 */
	listen({ api, preview, publics = {} }) {
		this.#api = new Set(Origins.#NAMES.map(name => `http://${name}:${api}`));
		this.#preview = new Set(Origins.#NAMES.map(name => `http://${name}:${preview}`));
		publics.api && this.#api.add(new URL(publics.api).origin);
		publics.preview && this.#preview.add(new URL(publics.preview).origin);
		for (const origin of this.#preview) {
			if (this.#configured.has(origin)) throw new Error(`The interface origin ${origin} is the origin of the preview listener, which never pairs`);
		}
	}

	/**
	 * The interface origins: the API listener's own, then the configured ones
	 */
	get interfaces() {
		return [...new Set([...this.#api, ...this.#configured])];
	}

	/**
	 * Whether an origin is an interface origin
	 *
	 * @param {string} origin
	 */
	interface(origin) {
		return this.#api.has(origin) || this.#configured.has(origin);
	}

	/**
	 * Whether an origin is one of the preview listener's own
	 *
	 * @param {string} origin
	 */
	preview(origin) {
		return this.#preview.has(origin);
	}

	/**
	 * Whether an origin reads the compiled modules of the preview listener
	 *
	 * @param {string} origin
	 */
	previews(origin) {
		return this.#preview.has(origin) || this.interface(origin) || this.#embeds.has(origin);
	}
}
