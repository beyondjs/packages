import { createHash } from 'node:crypto';
import { createServer } from 'node:http';

/**
 * An npm-compatible registry inside the test process, on an ephemeral loopback port: it answers package documents
 * (`GET /<name>`, a scoped name as `@scope%2fname`) and accepts publications as npm sends them (`PUT /<name>` with the
 * archive base64-encoded in `_attachments`), recording every request. It reaches no network and holds nothing on disk.
 *
 * A case decides how it behaves:
 *
 * - `token`: the bearer token a publication must present (`401` otherwise); reads need none unless `private` is set.
 * - `mode`: `normal`; `refuse` (every request `403`); `fail` (`500`); `silent` (a read is never answered, so the
 *   client's bound decides); `drop` (a publication is stored and its connection then ends without an answer, as when
 *   a network fails after the registry wrote the version).
 *
 * ```js
 * const registry = await new Registry({ token: 'test-token' }).start();
 * registry.release('@scope/ui', '1.0.0', { integrity: 'sha512-…' });   // a version that exists
 * registry.requests;   // [{method, path, name, status}]
 * registry.stop();
 * ```
 */
export class Registry {
	#server;
	#origin;
	#packages = new Map();
	#log = [];
	#token;
	#private;
	mode = 'normal';

	/**
	 * @param {{token?: string, private?: boolean}} [options]
	 */
	constructor({ token, private: closed = false } = {}) {
		this.#token = token;
		this.#private = closed;
	}

	get origin() {
		return this.#origin;
	}

	/**
	 * Every request, as `{method, path, name, status}`
	 */
	get requests() {
		return this.#log.map(entry => ({ ...entry }));
	}

	/**
	 * The publications received, as `{name, version, integrity, tag, access}`
	 */
	get published() {
		return this.#log.filter(entry => entry.method === 'PUT' && entry.publication).map(({ publication }) => ({ ...publication }));
	}

	/**
	 * A version the registry holds, with the digest of its archive
	 *
	 * @param {string} name
	 * @param {string} version
	 * @param {{integrity?: string, shasum?: string}} dist
	 */
	release(name, version, dist) {
		!this.#packages.has(name) && this.#packages.set(name, new Map());
		this.#packages.get(name).set(version, { name, version, dist: { ...dist, tarball: `${this.#origin}/${name}/-/${name.split('/').pop()}-${version}.tgz` } });
		return this;
	}

	async start() {
		this.#server = createServer((request, response) => this.#answer(request, response));
		await new Promise(resolve => this.#server.listen(0, '127.0.0.1', resolve));
		this.#origin = `http://127.0.0.1:${this.#server.address().port}`;
		return this;
	}

	stop() {
		this.#server?.closeAllConnections();
		this.#server?.close();
	}

	static #name(url) {
		const segments = decodeURIComponent(new URL(url, 'http://registry').pathname).split('/').filter(Boolean);
		return segments.slice(0, segments[0]?.startsWith('@') ? 2 : 1).join('/');
	}

	#answer(request, response) {
		const name = Registry.#name(request.url);
		const entry = { method: request.method, path: request.url, name, authorization: request.headers.authorization ? 'present' : 'absent' };
		this.#log.push(entry);
		const send = (status, body) => {
			entry.status = status;
			response.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body ?? {}));
		};

		if (this.mode === 'refuse') return send(403, { error: 'Forbidden' });
		if (this.mode === 'fail') return send(500, { error: 'Internal' });
		if (request.method === 'GET') {
			if (this.mode === 'silent') return void (entry.status = 'silent');
			if (this.#private && request.headers.authorization !== `Bearer ${this.#token}`) return send(401, { error: 'Unauthorized' });
			const releases = this.#packages.get(name);
			if (!releases) return send(404, { error: 'Not found' });
			return send(200, { name, versions: Object.fromEntries(releases) });
		}
		if (request.method === 'PUT') return this.#publish(request, entry, send, response);
		send(405, { error: 'Method not allowed' });
	}

	#publish(request, entry, send, response) {
		const chunks = [];
		request.on('data', chunk => chunks.push(chunk));
		request.on('end', () => {
			if (this.#token && request.headers.authorization !== `Bearer ${this.#token}`) return send(401, { error: 'You must be logged in to publish packages' });
			let document;
			try {
				document = JSON.parse(Buffer.concat(chunks).toString('utf8'));
			} catch {
				return send(400, { error: 'Not JSON' });
			}
			const [version] = Object.keys(document.versions ?? {});
			const [attachment] = Object.values(document._attachments ?? {});
			if (!version || !attachment) return send(400, { error: 'No version or archive' });
			if (this.#packages.get(entry.name)?.has(version)) return send(403, { error: `You cannot publish over the previously published versions: ${version}` });

			const bytes = Buffer.from(attachment.data, 'base64');
			const integrity = `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
			const shasum = createHash('sha1').update(bytes).digest('hex');
			const tag = Object.keys(document['dist-tags'] ?? {})[0];
			entry.publication = { name: entry.name, version, integrity, tag, access: document.access ?? null, bytes: bytes.length };
			this.release(entry.name, version, { integrity, shasum });
			if (this.mode === 'drop') {
				entry.status = 'dropped';
				return response.destroy();
			}
			send(200, { ok: true });
		});
	}
}
