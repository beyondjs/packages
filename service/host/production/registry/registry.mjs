import { Deadline } from '../../../deadline.mjs';

/**
 * The status of a package version at a registry, bound to the registry, the name, the version and the content of an
 * archive, and to when it was read (`production.status`).
 *
 * One `GET <registry>/<name>` (a scoped name as `@scope%2fname`) asks for the package document, with this machine's
 * credentials for that registry when it has them, within `BEYOND_REGISTRY_TIMEOUT` milliseconds (15 s) for the answer
 * and its body. A redirect is not followed. What it answers:
 *
 * | State | Meaning |
 * | --- | --- |
 * | `not-published` | The registry has no such name (404), or the name without this version |
 * | `published-matching` | The version is there and its `dist.integrity` (or its `dist.shasum`) equals the archive's |
 * | `version-exists-different` | The version is there with other content: it is never overwritten |
 * | `unverifiable` | The version is there and nothing compares it (no archive was named, or the registry records no digest), or the answer cannot be read |
 * | `refused` | The registry refused this machine's credentials (401, 403) |
 * | `unavailable` | No answer within the bound, no connection, or a failure of the registry (5xx, 429) |
 *
 * ```js
 * const status = await new Registry({ credentials }).status({ name, version, registry, archive });
 * ```
 */
export class Registry {
	static TIMEOUT = 15000;
	static #deadline = new Deadline('BEYOND_REGISTRY_TIMEOUT', Registry.TIMEOUT);

	#credentials;
	#fetch;
	#timeout;
	#clock;

	/**
	 * @param {{credentials: {authorization(url: string, directory?: string): Promise<string | undefined>}, fetch?:
	 * typeof fetch, environment?: object, clock?: {now(): number}}} options
	 */
	constructor({ credentials, fetch = globalThis.fetch, environment = process.env, clock = Date }) {
		this.#credentials = credentials;
		this.#fetch = fetch;
		this.#timeout = Registry.#deadline.read(environment);
		this.#clock = clock;
	}

	get timeout() {
		return this.#timeout;
	}

	/**
	 * The address of a package document: a scoped name keeps its `@` and encodes its slash, as npm requests it
	 *
	 * @param {string} registry
	 * @param {string} name
	 */
	static address(registry, name) {
		return `${registry.replace(/\/+$/, '')}/${name.startsWith('@') ? `@${encodeURIComponent(name.slice(1))}` : encodeURIComponent(name)}`;
	}

	/**
	 * @param {{name: string, version: string, registry: string, archive?: {id?: string, integrity: string, shasum?:
	 * string}, directory?: string}} request
	 * @returns {Promise<{state: string, registry: string, name: string, version: string, checked: string, archive?:
	 * object, published?: object, http?: number, reason?: string}>}
	 */
	async status({ name, version, registry, archive, directory }) {
		const base = { registry, name, version, ...(archive ? { archive: { ...(archive.id ? { id: archive.id } : {}), integrity: archive.integrity } } : {}) };
		const answer = (state, extra = {}) => ({ state, ...base, checked: new Date(this.#clock.now()).toISOString(), ...extra });

		let response, text;
		try {
			const authorization = await this.#credentials.authorization(registry, directory);
			const headers = { accept: 'application/vnd.npm.install-v1+json; q=1.0, application/json; q=0.8', ...(authorization ? { authorization } : {}) };
			const signal = AbortSignal.timeout(this.#timeout);
			response = await this.#fetch(Registry.address(registry, name), { headers, redirect: 'manual', signal });
			text = await response.text();
		} catch (error) {
			const timeout = error?.name === 'TimeoutError' || error?.name === 'AbortError';
			const reason = timeout ? `The registry did not answer within ${this.#timeout} ms (BEYOND_REGISTRY_TIMEOUT)` : `The registry could not be reached: ${error?.cause?.code ?? error?.message ?? error}`;
			return answer('unavailable', { reason });
		}

		const { status } = response;
		if (status === 404) return answer('not-published', { http: status, reason: 'The registry has no package of this name' });
		if (status === 401 || status === 403) return answer('refused', { http: status, reason: `The registry refused the credentials of this machine (HTTP ${status})` });
		if (status >= 500 || status === 429) return answer('unavailable', { http: status, reason: `The registry failed (HTTP ${status})` });
		if (status !== 200) return answer('unverifiable', { http: status, reason: `The registry answered HTTP ${status}, which is not a package document` });

		let document;
		try {
			document = JSON.parse(text);
		} catch {
			return answer('unverifiable', { http: status, reason: 'The registry answered a package document that is not JSON' });
		}
		const release = document?.versions?.[version];
		if (!release) return answer('not-published', { http: status, reason: `The registry has "${name}" without the version ${version}` });

		const dist = release.dist ?? {};
		const published = { ...(dist.integrity ? { integrity: dist.integrity } : {}), ...(dist.shasum ? { shasum: dist.shasum } : {}), ...(dist.tarball ? { tarball: dist.tarball } : {}) };
		if (!archive) return answer('unverifiable', { http: status, published, reason: 'The version is published; no archive was named to compare it with' });
		if (dist.integrity) {
			const matching = dist.integrity.split(/\s+/).includes(archive.integrity);
			return answer(matching ? 'published-matching' : 'version-exists-different', { http: status, published });
		}
		if (dist.shasum && archive.shasum) return answer(dist.shasum === archive.shasum ? 'published-matching' : 'version-exists-different', { http: status, published });
		return answer('unverifiable', { http: status, published, reason: 'The registry records no digest of this version to compare with the archive' });
	}
}
