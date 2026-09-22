/**
 * The consumer of a prepared application: a static origin over the delivered files, and the page that
 * loads them.
 *
 * Nothing of a development service is involved. The page has the import map the preparation wrote, imports
 * the entry module of the application and lets the delivered artifacts do the rest: register their
 * elements, load their runtime and adopt their stylesheets.
 */
import { createReadStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';

const MEDIA = {
	'.mjs': 'text/javascript; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.json': 'application/json; charset=utf-8',
	'.html': 'text/html; charset=utf-8',
	'.map': 'application/json; charset=utf-8'
};

/**
 * A static origin over a directory of delivered outputs, which answers nothing else
 */
export class Delivered {
	#root;
	#server;
	#page;

	origin;
	requests = [];

	/**
	 * @param root The directory the preparation wrote
	 * @param page The document of the application
	 */
	constructor(root, page) {
		this.#root = root;
		this.#page = page;
	}

	get files() {
		return readdir(this.#root);
	}

	async start() {
		this.#server = createServer(async (incoming, outgoing) => {
			const { pathname } = new URL(incoming.url, 'http://delivered');
			this.requests.push(pathname);

			const headers = { 'access-control-allow-origin': '*', 'cache-control': 'no-store' };
			if (pathname === '/') return outgoing.writeHead(200, { ...headers, 'content-type': MEDIA['.html'] }).end(this.#page);

			// A browser asks for an icon on its own; answering it keeps the page free of a failure it caused
			if (pathname === '/favicon.ico') return outgoing.writeHead(204, headers).end();

			// Only a file of the delivered directory is served, and never one outside it
			const path = join(this.#root, normalize(pathname).replace(/^(\.\.[/\\])+/, ''));
			const found = await stat(path).catch(() => void 0);
			if (!found?.isFile()) return outgoing.writeHead(404, headers).end();

			// The compiled-module contract names a module and its stylesheet by family, without an extension
			const family = /\/styles\//.test(pathname) ? '.css' : /\/modules\//.test(pathname) ? '.js' : extname(path);
			outgoing.writeHead(200, { ...headers, 'content-type': MEDIA[family] ?? 'application/octet-stream' });
			createReadStream(path).pipe(outgoing);
		});

		await new Promise(done => this.#server.listen(0, '127.0.0.1', done));
		this.origin = `http://127.0.0.1:${this.#server.address().port}`;
		return this;
	}

	stop() {
		this.#server?.closeAllConnections();
		this.#server?.close();
	}
}

/**
 * The document of the application: the import map of the delivered modules and the import of its entry
 */
export const document = (importmap, entry) => `<!DOCTYPE html>
<html lang="en">
	<head>
		<meta charset="utf-8" />
		<title>Prepared application</title>
		<script type="importmap">${JSON.stringify(importmap)}</script>
	</head>
	<body>
		<script type="module">
			import ${JSON.stringify(entry)};
		</script>
	</body>
</html>
`;

/**
 * What a widget of the page shows: the text of its card and the colour its stylesheet gives it
 */
export const shown = (page, element, selector) =>
	page.evaluate(
		({ element, selector }) => {
			const host = window.document.querySelector(element);
			const found = host?.shadowRoot?.querySelector(selector);
			if (!found) return { found: false, root: !!host?.shadowRoot, html: host?.shadowRoot?.innerHTML?.slice(0, 200) };
			return { found: true, text: found.textContent.trim(), color: window.getComputedStyle(found).color };
		},
		{ element, selector }
	);
