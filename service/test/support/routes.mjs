import { request } from 'node:http';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import { Installer } from '../../host/installer.mjs';
import { InstallationRoutes } from '../../host/routes.mjs';

/**
 * The installation routes of a host mounted alone on an ephemeral loopback port, over the stand-ins of a `Stand`
 * (`installation.mjs`), as the host mounts them: before a middleware that lets any origin read every answer and
 * answers every preflight (the compiled-module routes do), and with the error handler of a service, which answers
 * an unexpected failure `500`. Everything is released when the case ends.
 *
 * ```js
 * const { root, post, get, send } = await mount(t, stand, { bind: '127.0.0.1', queue: 100 });
 * await post('{"update":true}');                          // {status, body, headers}
 * await send('POST', { 'content-type': 'text/plain', origin: 'https://site.example' }, '{}');
 * ```
 *
 * @param {import('node:test').TestContext} t
 * @param {import('./installation.mjs').Stand} stand
 * @param {{bind?: string, queue?: number, deadline?: number, holds?: object}} [options] The address the host says it
 * listens on, the queue bound, the deadline of one installation and what an installation holds while it runs
 */
export const mount = async (t, stand, { bind, ...given } = {}) => {
	const root = realpathSync(mkdtempSync(join(tmpdir(), 'beyond-installer-')));
	t.after(() => rmSync(root, { recursive: true, force: true }));

	const options = Object.fromEntries(Object.entries(given).filter(([, value]) => value !== undefined));
	const installer = new Installer({ root, hosted: stand.hosted, modules: stand.modules, ...options });
	const app = express();
	new InstallationRoutes(installer, { bind }).setup(app);
	app.use((request, response, next) => {
		response.setHeader('access-control-allow-origin', '*');
		request.method === 'OPTIONS' ? response.status(204).end() : next();
	});
	app.use((error, request, response, next) => response.status(500).json({ error: { code: 'INTERNAL', message: error.message } }));

	const server = app.listen(0, '127.0.0.1');
	await new Promise(resolve => server.once('listening', resolve));
	t.after(() => {
		server.closeAllConnections();
		return new Promise(resolve => server.close(resolve));
	});
	const { port } = server.address();

	/**
	 * A request with exactly the headers given, `Host` included, answered as `{status, body, headers}`
	 */
	const send = (method, headers, body) =>
		new Promise((resolve, reject) => {
			const sent = request({ host: '127.0.0.1', port, path: '/installation', method, headers }, response => {
				let text = '';
				response.setEncoding('utf8').on('data', chunk => (text += chunk));
				response.on('end', () => resolve({ status: response.statusCode, body: text ? JSON.parse(text) : void 0, headers: response.headers }));
			});
			sent.on('error', reject);
			sent.end(body);
		});

	const host = `127.0.0.1:${port}`;
	const post = body => send('POST', { host, 'content-type': 'application/json' }, body);
	const get = async () => (await send('GET', { host })).body;
	return { root, port, installer, send, post, get };
};
