/**
 * The origin of the SystemJS page of the updates validation: it publishes the page of `pages/system.html`
 * and the build of SystemJS installed in `BEYOND_SYSTEMJS`, and forwards every other request to the
 * development service unchanged, so the page, its modules, its updates and its event stream share one
 * origin. It is a stand-in for whatever serves a SystemJS application, not a delivery.
 */
import { createServer, request } from 'node:http';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

export class SystemPage {
	static PAGE = '/system.html';

	#server;
	#target;
	#files = new Map();

	origin;

	/**
	 * The SystemJS build, from the directory named by `BEYOND_SYSTEMJS` where the `systemjs` package is
	 * installed: this repository does not declare it
	 */
	static loader() {
		const { BEYOND_SYSTEMJS } = process.env;
		if (!BEYOND_SYSTEMJS) throw new Error('Set BEYOND_SYSTEMJS to a directory where "systemjs" is installed.');
		const require = createRequire(pathToFileURL(join(resolve(BEYOND_SYSTEMJS), 'package.json')).href);
		return require.resolve('systemjs/dist/system.js');
	}

	/**
	 * @param target The origin of the development service
	 */
	async start(target) {
		this.#target = new URL(target);
		this.#files.set(SystemPage.PAGE, { type: 'text/html; charset=utf-8', body: await readFile(join(here, 'pages/system.html')) });
		this.#files.set('/systemjs/system.js', { type: 'application/javascript; charset=utf-8', body: await readFile(SystemPage.loader()) });

		this.#server = createServer((incoming, outgoing) => {
			const file = this.#files.get(new URL(incoming.url, 'http://page').pathname);
			if (file) return void outgoing.writeHead(200, { 'content-type': file.type }).end(file.body);

			const { hostname, port } = this.#target;
			const upstream = request({ hostname, port, path: incoming.url, method: incoming.method, headers: incoming.headers }, answer => {
				outgoing.writeHead(answer.statusCode, answer.headers);
				answer.pipe(outgoing);
				// A service that stops cuts its event stream: the page must see its stream end too
				answer.on('close', () => !outgoing.writableEnded && outgoing.destroy());
			});
			upstream.on('error', () => outgoing.destroy());
			outgoing.on('close', () => upstream.destroy());
			incoming.pipe(upstream);
		});
		this.origin = await new Promise(done => this.#server.listen(0, '127.0.0.1', () => done(`http://127.0.0.1:${this.#server.address().port}`)));
		return this;
	}

	get url() {
		return `${this.origin}${SystemPage.PAGE}`;
	}

	stop() {
		this.#server?.closeAllConnections();
		this.#server?.close();
	}
}
