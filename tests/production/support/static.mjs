import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';

const TYPES = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.json': 'application/json',
	'.svg': 'image/svg+xml',
	'.png': 'image/png'
};

/**
 * An independent static host of a web export, on an ephemeral loopback port: what a hosting provider does with a
 * directory, and nothing of Beyond. It serves the files of the directory under a base path with their media types, and
 * answers an address without a file extension that is no file (a route of the page, `/users/42`) with the export's
 * `index.html`, the history fallback single-page hosts provide. Every request is recorded.
 *
 * ```js
 * const host = await new StaticHost(directory, { base: '/app/' }).start();
 * host.origin;      // http://127.0.0.1:<port>
 * host.requests;    // [{path, status}]
 * ```
 */
export class StaticHost {
	#directory;
	#base;
	#server;
	#origin;
	#log = [];

	/**
	 * @param {string} directory
	 * @param {{base?: string}} [options]
	 */
	constructor(directory, { base = '/' } = {}) {
		this.#directory = directory;
		this.#base = base;
	}

	get origin() {
		return this.#origin;
	}

	get requests() {
		return this.#log.map(entry => ({ ...entry }));
	}

	async start() {
		this.#server = createServer((request, response) => void this.#answer(request, response));
		await new Promise(resolve => this.#server.listen(0, '127.0.0.1', resolve));
		this.#origin = `http://127.0.0.1:${this.#server.address().port}`;
		return this;
	}

	stop() {
		this.#server?.closeAllConnections();
		this.#server?.close();
	}

	async #file(path) {
		const file = normalize(join(this.#directory, ...path.split('/').filter(Boolean).map(decodeURIComponent)));
		if (file !== this.#directory && !file.startsWith(`${this.#directory}${sep}`)) return;
		const found = await stat(file).catch(() => void 0);
		return found?.isFile() ? file : void 0;
	}

	async #answer(request, response) {
		const path = new URL(request.url, 'http://host').pathname;
		const entry = { path, status: 404 };
		this.#log.push(entry);
		if (!path.startsWith(this.#base)) return response.writeHead(404).end();
		const relative = path.slice(this.#base.length);
		let file = await this.#file(relative || 'index.html');
		if (!file && !extname(relative)) file = await this.#file('index.html');
		if (!file) return response.writeHead(404).end();
		const content = await readFile(file);
		entry.status = 200;
		response.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', etag: `"${createHash('sha256').update(content).digest('hex')}"`, 'cache-control': 'no-cache' });
		response.end(request.method === 'HEAD' ? void 0 : content);
	}
}

/**
 * A stand-in of CDN delivery for the `cdn` strategy, not CDN itself: it answers the compiled-module paths a case gives it
 * with the bytes the case gives, as the contract asks of a CDN (the media type of the family, the strong `sha256` entity
 * tag of the bytes, `Access-Control-Allow-Origin: *`), to `HEAD` and `GET`, and records every request
 */
export class CdnStand {
	#server;
	#origin;
	#outputs = new Map();
	#log = [];

	get origin() {
		return this.#origin;
	}

	get requests() {
		return this.#log.map(entry => ({ ...entry }));
	}

	/**
	 * @param {string} path A compiled-module path, `/m/<identity>/modules/<subpath>`
	 * @param {string} content
	 */
	serve(path, content) {
		this.#outputs.set(path, Buffer.from(content));
		return this;
	}

	async start() {
		this.#server = createServer((request, response) => {
			const path = new URL(request.url, 'http://cdn').pathname;
			const content = this.#outputs.get(path);
			this.#log.push({ method: request.method, path, status: content ? 200 : 404 });
			if (!content) return response.writeHead(404, { 'access-control-allow-origin': '*' }).end();
			const type = path.includes('/styles/') ? 'text/css; charset=utf-8' : 'application/javascript; charset=utf-8';
			const etag = `"sha256-${createHash('sha256').update(content).digest('hex')}"`;
			response.writeHead(200, { 'content-type': type, etag, 'access-control-allow-origin': '*', 'access-control-expose-headers': 'etag' });
			response.end(request.method === 'HEAD' ? void 0 : content);
		});
		await new Promise(resolve => this.#server.listen(0, '127.0.0.1', resolve));
		this.#origin = `http://127.0.0.1:${this.#server.address().port}`;
		return this;
	}

	stop() {
		this.#server?.closeAllConnections();
		this.#server?.close();
	}
}
