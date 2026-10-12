import { ResourcePath } from '@beyond-js/artifact-api';

/**
 * The addresses of a web export. A preview gives the modules it serves addresses relative to its document
 * (`../m/<identity>/modules/<subpath>?<options>`); an export writes the same resource under its compiled-module path,
 * with the extension a static host serves it by, and addresses it from the export's base:
 *
 * | Resource | Preview address | Export file | Export address |
 * | --- | --- | --- | --- |
 * | Module | `../m/@a/b@1.0.0/modules/main?…` | `m/@a/b@1.0.0/modules/main.js` | `<base>m/@a/b@1.0.0/modules/main.js` |
 * | Stylesheet | `../m/@a/b@1.0.0/styles/main?…` | `m/@a/b@1.0.0/styles/main.css` | `<base>m/@a/b@1.0.0/styles/main.css` |
 * | Asset | `../m/@a/b@1.0.0/assets/main/logo.svg` | `m/@a/b@1.0.0/assets/main/logo.svg` | `<base>m/@a/b@1.0.0/assets/main/logo.svg` |
 * | Scope | `../m/@a/b@1.0.0/` | | `<base>m/@a/b@1.0.0/` |
 *
 * An address that a module of the export writes relative to itself (`new URL('../assets/main/logo.svg',
 * import.meta.url)`) resolves the same way from the file, because the extension does not change its directory. An
 * absolute address (the CDN) is kept as it is.
 */
export class Addresses {
	static EXTENSIONS = Object.freeze({ module: '.js', style: '.css', asset: '' });

	#base;

	/**
	 * @param {string} base The path the export is served under, starting and ending with `/`
	 */
	constructor(base) {
		this.#base = base;
	}

	get base() {
		return this.#base;
	}

	/**
	 * Whether an address is on another origin (the CDN), rather than one this environment served
	 *
	 * @param {string} url
	 */
	static remote(url) {
		return /^https?:\/\//.test(url);
	}

	/**
	 * The path of a preview address, from the root of the service: `/m/…`, without its options
	 *
	 * @param {string} url
	 * @returns {string | undefined} Undefined for an address that is not one of this environment
	 */
	static path(url) {
		if (typeof url !== 'string' || Addresses.remote(url) || url.startsWith('data:')) return;
		const path = url.replace(/^(\.\.)?(?=\/)/, '').split(/[?#]/)[0];
		return path.startsWith('/m/') ? path : void 0;
	}

	/**
	 * What a path addresses: its kind, its identity and, for an asset, its path in the package
	 *
	 * @param {string} path
	 */
	static resource(path) {
		return ResourcePath.parse(path);
	}

	/**
	 * The file of a resource in the export, relative to its directory, decoded as a static host decodes an address
	 *
	 * @param {string} path The path of the resource from the root of the service
	 * @param {'module' | 'style' | 'asset'} kind
	 */
	static file(path, kind) {
		return decodeURIComponent(path.slice(1)) + Addresses.EXTENSIONS[kind];
	}

	/**
	 * The address of a resource in the exported page
	 *
	 * @param {string} path The path of the resource from the root of the service
	 * @param {'module' | 'style' | 'asset'} kind
	 */
	address(path, kind) {
		return `${this.#base}${path.slice(1)}${Addresses.EXTENSIONS[kind]}`;
	}

	/**
	 * The address of a scope (a package prefix ending with `/`) in the exported page, or the remote one as it is
	 *
	 * @param {string} prefix
	 */
	scope(prefix) {
		const path = Addresses.path(prefix);
		return path ? `${this.#base}${path.slice(1)}` : prefix;
	}
}
