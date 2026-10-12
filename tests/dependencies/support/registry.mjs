import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import semver from 'semver';
import { archive, integrity } from '../../cdn-resolution/registry.mjs';

/**
 * An npm-compatible registry in the test process, on an allocated loopback port: what dependency management reads
 * package documents (`GET /<name>`, with `dist-tags`, the manifests of every release and their `deprecated`),
 * release documents (`GET /<name>/<version>`) and archives (`GET /<name>/-/<file>.tgz`) from, with no network.
 *
 * - `token`: every request must carry `Authorization: Bearer <token>`, else `401` (a private registry).
 * - `denied`: names answered `403` whatever the credential (a package the credential may not read).
 * - Releases are published from the fixture directories `registry/<name>/<version>/` (a `package.json` and its files);
 *   publishing while it runs is how a newer release appears. `latest` is the highest stable version published.
 * - Every request is recorded (`requests`), which is how a case asserts what was and was not asked.
 */
export class Registry {
	#server;
	#token;
	#denied;
	#packages = new Map();
	#log = [];
	#held = new Map();

	/**
	 * @param {{token?: string, denied?: string[]}} [options]
	 */
	constructor({ token, denied = [] } = {}) {
		this.#token = token;
		this.#denied = new Set(denied);
	}

	/**
	 * The base address, which a workspace gives as `registry=` (or a scope's registry) in its `.npmrc`
	 */
	get url() {
		return `http://127.0.0.1:${this.#server.address().port}/`;
	}

	/**
	 * The `host:port/` key of `.npmrc` credentials for this registry
	 */
	get key() {
		return `//127.0.0.1:${this.#server.address().port}/`;
	}

	get requests() {
		return this.#log.map(request => ({ ...request }));
	}

	clear() {
		this.#log = [];
	}

	/**
	 * Keeps the requests of a name waiting until `release(name)`, so a case can act while work waits on the registry
	 */
	hold(name) {
		this.#held.set(name, []);
	}

	/**
	 * Answers the requests of a held name, and the later ones at once
	 */
	release(name) {
		const waiting = this.#held.get(name) ?? [];
		this.#held.delete(name);
		waiting.forEach(answer => answer());
	}

	/**
	 * Publishes one release directory of the fixtures
	 *
	 * @param {string} directory `…/registry/<name>/<version>`
	 */
	async publish(directory) {
		const manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));
		const entries = readdirSync(directory).map(file => ({ name: `package/${file}`, content: readFileSync(join(directory, file)) }));
		const bytes = await archive(entries);
		const shasum = createHash('sha1').update(bytes).digest('hex');
		if (!this.#packages.has(manifest.name)) this.#packages.set(manifest.name, new Map());
		this.#packages.get(manifest.name).set(manifest.version, { manifest, bytes, integrity: integrity(bytes), shasum });
	}

	#release(name, version) {
		const { manifest, integrity: digest, shasum } = this.#packages.get(name).get(version);
		const file = `${name.split('/').pop()}-${version}.tgz`;
		return { ...manifest, dist: { tarball: `${this.url}${name}/-/${file}`, integrity: digest, shasum } };
	}

	#packument(name) {
		const releases = this.#packages.get(name);
		const versions = {};
		for (const version of releases.keys()) versions[version] = this.#release(name, version);
		const stable = [...releases.keys()].filter(version => !semver.prerelease(version)).sort(semver.rcompare);
		return { name, 'dist-tags': stable.length ? { latest: stable[0] } : {}, versions };
	}

	#handle(request, response) {
		const send = (status, body, type = 'application/json') => {
			response.writeHead(status, { 'content-type': type });
			response.end(Buffer.isBuffer(body) ? body : JSON.stringify(body));
		};
		const path = decodeURIComponent(new URL(request.url, 'http://registry').pathname).slice(1);
		const tarball = /^((?:@[^/]+\/)?[^/]+)\/-\/(.+\.tgz)$/.exec(path);
		const packument = !tarball && /^((?:@[^/]+\/)?[^/]+)$/.exec(path);
		const release = !tarball && !packument && /^((?:@[^/]+\/)?[^/]+)\/([^/]+)$/.exec(path);
		const name = (tarball || packument || release)?.[1];
		const kind = tarball ? 'archive' : packument ? 'packument' : release ? 'release' : 'unknown';
		this.#log.push({ kind, name, path, credential: !!request.headers.authorization });

		if (this.#token && request.headers.authorization !== `Bearer ${this.#token}`) return send(401, { error: 'authentication required' });
		if (this.#denied.has(name)) return send(403, { error: 'forbidden' });
		const releases = name && this.#packages.get(name);
		if (!releases?.size) return send(404, { error: 'not found' });
		if (packument) return send(200, this.#packument(name));
		if (release) return releases.has(release[2]) ? send(200, this.#release(name, release[2])) : send(404, { error: 'not found' });
		const version = [...releases.keys()].find(one => `${name.split('/').pop()}-${one}.tgz` === tarball?.[2]);
		return version ? send(200, releases.get(version).bytes, 'application/octet-stream') : send(404, { error: 'not found' });
	}

	async start() {
		this.#server = createServer((request, response) => {
			const name = Registry.#name(request.url);
			const waiting = this.#held.get(name);
			waiting ? waiting.push(() => this.#handle(request, response)) : this.#handle(request, response);
		});
		await new Promise(resolve => this.#server.listen(0, '127.0.0.1', resolve));
		return this;
	}

	/**
	 * The package name a request addresses
	 */
	static #name(url) {
		const path = decodeURIComponent(new URL(url, 'http://registry').pathname).slice(1);
		return /^((?:@[^/]+\/)?[^/]+)/.exec(path)?.[1];
	}

	async stop() {
		[...this.#held.keys()].forEach(name => this.release(name));
		this.#server?.closeAllConnections?.();
		await new Promise(resolve => (this.#server ? this.#server.close(resolve) : resolve()));
	}
}
