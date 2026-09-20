const ports: Record<string, string> = { 'http:': '80', 'https:': '443' };

/**
 * The normalized address of a registry or host: scheme, host name, port and path prefix are read once,
 * and every request, identity and credential lookup derives from the same values.
 *
 * Accepted inputs are the forms found in settings: a full URL (`https://host:4873/npm/`), a host with an
 * optional path (`host/npm`) and the scheme-less key of a credential (`//host:4873/npm/`).
 */
export /*bundle*/ class Endpoint {
	#url?: URL;

	/**
	 * False when the value cannot be read as an HTTP(S) address
	 */
	get valid() {
		return !!this.#url;
	}

	get scheme() {
		return this.#url.protocol.slice(0, -1);
	}

	/**
	 * Host name without port, lowercased
	 */
	get hostname() {
		return this.#url.hostname;
	}

	/**
	 * Host name with its port when it is not the default of the scheme
	 */
	get host() {
		return this.#url.host;
	}

	/**
	 * Path prefix without a trailing slash: '' or '/npm'
	 */
	get prefix() {
		return this.#url.pathname.replace(/\/+$/, '');
	}

	/**
	 * Scheme, host, port and prefix without a trailing slash: what requests are built from
	 */
	get base() {
		return `${this.#url.protocol}//${this.host}${this.prefix}`;
	}

	/**
	 * Host, port and prefix: the identity of the registry, independent of the scheme
	 */
	get registry() {
		return `${this.host}${this.prefix}`;
	}

	/**
	 * The keys a credential can be stored under, from the most specific path to the host alone.
	 * A credential declared for a path never applies outside it, nor to another port.
	 */
	get keys(): string[] {
		const segments = this.prefix.split('/').filter(Boolean);
		const keys: string[] = [];
		for (let length = segments.length; length >= 0; length--) {
			keys.push([this.host, ...segments.slice(0, length)].join('/'));
		}
		return keys;
	}

	constructor(value: string) {
		if (typeof value !== 'string' || !value.trim()) return;
		value = value.trim();

		if (value.startsWith('//')) value = `https:${value}`;
		else if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) value = `https://${value}`;

		try {
			const url = new URL(value);
			if (!ports[url.protocol] || !url.hostname) return;

			// Credentials, queries and fragments are never part of a registry address
			url.username = '';
			url.password = '';
			url.search = '';
			url.hash = '';
			this.#url = url;
		} catch {}
	}

	/**
	 * Builds a request URL under the prefix. Segments are expected to be already encoded.
	 */
	url(...segments: string[]): string {
		return [this.base, ...segments].join('/');
	}

	/**
	 * True when a URL belongs to this registry: same host and port, under the same prefix
	 */
	contains(url: string): boolean {
		const other = new Endpoint(url);
		if (!other.valid || other.host !== this.host) return false;
		return other.prefix === this.prefix || other.prefix.startsWith(`${this.prefix}/`);
	}
}
