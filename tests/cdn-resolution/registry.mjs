/**
 * An npm-compatible registry for tests: it serves generated package metadata and real gzipped archives
 * over HTTP, on its own port and below a path prefix, optionally requiring a bearer token. It counts the
 * requests it receives by type, which is how a test establishes what a stage did and did not fetch.
 */
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import tar from 'tar-stream';

/**
 * Builds a gzipped archive from entries. An entry is `{name, content}` for a file, or a raw tar header
 * (`{name, type: 'symlink', linkname}`) to build the archives a fetch must refuse.
 */
export const archive = entries =>
	new Promise((resolve, reject) => {
		const pack = tar.pack();
		const chunks = [];
		pack.on('data', chunk => chunks.push(chunk));
		pack.on('error', reject);
		pack.on('end', () => resolve(gzipSync(Buffer.concat(chunks))));

		for (const { content, ...header } of entries) pack.entry(header, content);
		pack.finalize();
	});

export const integrity = bytes => `sha512-${createHash('sha512').update(bytes).digest('base64')}`;

export class FakeRegistry {
	#server;
	#packages = new Map();
	#prefix;
	#token;
	#metadata;
	#faults = new Map();

	requests = { packument: 0, manifest: 0, tarball: 0, other: 0 };
	// Every request: type, path and whether it carried the expected credential
	log = [];

	get url() {
		return `http://127.0.0.1:${this.#server.address().port}${this.#prefix}`;
	}

	get host() {
		return `127.0.0.1:${this.#server.address().port}`;
	}

	/**
	 * @param options.prefix Path prefix the registry is served below
	 * @param options.token Bearer token every request must carry
	 * @param options.metadata 'full' (default) publishes release manifests in the package metadata;
	 *   'versions' publishes only the version list, so each manifest needs its own request
	 */
	constructor({ prefix = '', token, metadata = 'full' } = {}) {
		this.#prefix = prefix;
		this.#token = token;
		this.#metadata = metadata;
	}

	/**
	 * Publishes a release. `files` are the archive entries below `package/`; `entries` replaces the whole
	 * archive with raw entries; `bytes` replaces the archive served (the metadata keeps the real digest).
	 */
	async publish({ name, version, files, entries, ...manifest }) {
		const pkg = { name, version, ...manifest };
		const content = entries || [
			{ name: 'package/package.json', content: JSON.stringify(pkg) },
			...Object.entries(files || { 'index.js': `module.exports = '${name}@${version}';` }).map(
				([file, content]) => ({ name: `package/${file}`, content })
			)
		];
		const bytes = await archive(content);
		const shasum = createHash('sha1').update(bytes).digest('hex');

		if (!this.#packages.has(name)) this.#packages.set(name, new Map());
		this.#packages.get(name).set(version, { manifest: pkg, bytes, integrity: integrity(bytes), shasum });
		return this;
	}

	unpublish(name, version) {
		version ? this.#packages.get(name)?.delete(version) : this.#packages.delete(name);
	}

	release(name, version) {
		return this.#packages.get(name)?.get(version);
	}

	/**
	 * Makes the archive of a release misbehave: 'corrupt' serves bytes that are no archive, 'truncate'
	 * closes the connection halfway, 'unavailable' answers 503, 'chunked' serves the real archive without
	 * declaring its length, and a Buffer serves those bytes instead (another valid archive, for example)
	 */
	fault(name, version, kind) {
		kind ? this.#faults.set(`${name}@${version}`, kind) : this.#faults.delete(`${name}@${version}`);
	}

	reset() {
		this.requests = { packument: 0, manifest: 0, tarball: 0, other: 0 };
		this.log = [];
	}

	#file(name, version) {
		return `${name.split('/').pop()}-${version}.tgz`;
	}

	#manifest(name, version) {
		const { manifest, integrity, shasum } = this.#packages.get(name).get(version);
		const tarball = `${this.url}/${name}/-/${this.#file(name, version)}`;
		return { ...manifest, dist: { tarball, integrity, shasum } };
	}

	#handle(request, response) {
		const send = (status, body, type = 'application/json') => {
			response.writeHead(status, { 'content-type': type });
			response.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
		};

		const url = new URL(request.url, 'http://registry');
		const authorized = !this.#token || request.headers.authorization === `Bearer ${this.#token}`;
		const path = decodeURIComponent(url.pathname);
		const record = type => {
			this.requests[type]++;
			this.log.push({ type, path, authorized, credential: !!request.headers.authorization });
		};

		if (!path.startsWith(`${this.#prefix}/`)) return record('other'), send(404, { error: 'outside prefix' });
		const rest = path.slice(this.#prefix.length + 1);

		const tarball = /^((?:@[^/]+\/)?[^/]+)\/-\/(.+)\.tgz$/.exec(rest);
		// A scoped name has a slash of its own: the package document is recognized before a release
		const packument = /^((?:@[^/]+\/)?[^/]+)$/.exec(rest);
		const manifest = !packument && /^((?:@[^/]+\/)?[^/]+)\/([^/]+)$/.exec(rest);
		record(tarball ? 'tarball' : manifest ? 'manifest' : packument ? 'packument' : 'other');

		if (!authorized) return send(401, { error: 'authentication required' });

		if (tarball) {
			const [, name, file] = tarball;
			const versions = this.#packages.get(name);
			const version = versions && [...versions.keys()].find(v => this.#file(name, v) === `${file}.tgz`);
			if (!version) return send(404, { error: 'not found' });

			const fault = this.#faults.get(`${name}@${version}`);
			const { bytes } = versions.get(version);
			if (fault === 'unavailable') return send(503, { error: 'unavailable' });
			if (fault === 'corrupt') return send(200, Buffer.from(bytes).reverse(), 'application/octet-stream');
			if (Buffer.isBuffer(fault)) return send(200, fault, 'application/octet-stream');
			if (fault === 'chunked') {
				response.writeHead(200, { 'content-type': 'application/octet-stream', 'transfer-encoding': 'chunked' });
				for (let at = 0; at < bytes.length; at += 512) response.write(bytes.subarray(at, at + 512));
				return response.end();
			}
			if (fault === 'truncate') {
				response.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': bytes.length });
				response.write(bytes.subarray(0, Math.floor(bytes.length / 2)));
				return setTimeout(() => response.destroy(), 20);
			}
			return send(200, bytes, 'application/octet-stream');
		}

		if (manifest) {
			const [, name, version] = manifest;
			if (!this.#packages.get(name)?.has(version)) return send(404, { error: 'not found' });
			return send(200, this.#manifest(name, version));
		}

		if (packument) {
			const [, name] = packument;
			const versions = this.#packages.get(name);
			if (!versions?.size) return send(404, { error: 'not found' });

			const document = { name, 'dist-tags': {}, versions: {} };
			for (const version of versions.keys()) {
				document.versions[version] = this.#metadata === 'full' ? this.#manifest(name, version) : null;
			}
			return send(200, document);
		}

		send(404, { error: 'not found' });
	}

	async start() {
		this.#server = createServer((request, response) => this.#handle(request, response));
		await new Promise(resolve => this.#server.listen(0, '127.0.0.1', resolve));
		return this;
	}

	async stop() {
		this.#server.closeAllConnections?.();
		await new Promise(resolve => this.#server.close(resolve));
	}
}
