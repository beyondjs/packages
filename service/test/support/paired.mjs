import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import { Attachments } from '../../host/attachments.mjs';
import { Events } from '../../host/events.mjs';
import { Hosts } from '../../host/hosts.mjs';
import { Caller } from '../../host/pairing/caller.mjs';
import { Portable } from '../../host/portable.mjs';
import { SameOrigin } from '../../host/same-origin.mjs';

export const UI = 'https://ui.example';
export const EMBED = 'https://site.example';
export const EVIL = 'https://evil.example';
export const CREDENTIAL = 'c'.repeat(43);
export const OWNER = 'owner-token';
export const BROWSER = 'target=browser&format=esm&env=development&min=false&sourcemap=inline';

/**
 * A service composed as the host composes one, on ephemeral loopback ports: the `Host` check every service makes,
 * then, for one that pairs, the real `Portable` (two listeners, the cross-origin rules, the access policy, pairing and
 * exports over a temporary root) and the real `Attachments`; then stand-ins of what follows in the real host, in its
 * order: the cross-origin headers the compiled-module routes set on their own paths (`*`), compiled modules and updates
 * (`GET /m/…`, `/u/…`), a resolution document, the session, the preview, and routes of the development extension that
 * read the caller the policy left on the request as the extension does: a file (`GET /files/content/…`, which holds
 * `SECRET`), a batch parsed only as JSON (`POST /files/operations`, recorded in `writes`), a build started or cancelled
 * without a body (`POST /builds`, `POST /builds/:id/cancel`, recorded in `builds`) and the event stream (`GET /events`:
 * no source or export events without `files.read`, `access.ended` when a pairing ends). A loopback service that does not
 * pair gets the rules of `SameOrigin` as the host gives them.
 *
 * ```js
 * const service = await compose(t);                          // pairs; compose(t, { pairing: false }) does not
 * await service.send('GET', '/session', { origin: UI });       // the API listener
 * await service.send('GET', '/preview/', {}, void 0, 'preview');
 * ```
 *
 * @param {import('node:test').TestContext} t
 * @param {{pairing?: false | object, bind?: string, environment?: object}} [options]
 */
export const compose = async (t, { pairing = { origins: [UI], embeds: [EMBED] }, bind = '127.0.0.1', environment = {} } = {}) => {
	const root = realpathSync(mkdtempSync(join(tmpdir(), 'beyond paired ')));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	writeFileSync(join(root, 'package.json'), JSON.stringify({ name: '@fixture/paired', version: '1.0.0' }));

	const app = express();
	const hosts = new Hosts({ bind });
	hosts.setup(app);
	const attachments = new Attachments(OWNER);
	const settings = { root, bind, credential: CREDENTIAL, pairing };
	const session = async () => ({ protocol: 'beyond-dev-session/1' });
	const announce = (type, data) => attachments.announce(type, data);
	const portable = pairing ? new Portable(settings, { hosts, events: new Events(), session, announce, environment }) : void 0;
	portable?.guard(app);
	!portable && hosts.loopback && !environment.BEYOND_AUTHORITY && new SameOrigin({ environment }).setup(app);
	portable?.setup(app);

	const writes = [];
	const builds = [];
	app.use(['/m', '/u', '/resolution.json', '/importmap.json'], (request, response, next) => {
		response.setHeader('access-control-allow-origin', '*');
		response.setHeader('access-control-expose-headers', 'ETag, SourceMap, Link');
		request.method === 'OPTIONS' ? response.status(204).end() : next();
	});
	app.get(['/m/*', '/u/*'], (request, response) => response.type('text/javascript').send('export default 1;\n'));
	app.get('/resolution.json', (request, response) => response.json({ protocol: 'beyond-resolution/1' }));
	attachments.setup(app);
	app.get('/session', (request, response) => response.json({ protocol: 'beyond-dev-session/1' }));
	app.get('/preview/*', (request, response) => response.type('text/html').send('<!doctype html>'));
	const refused = (request, response, capability) => {
		const refusal = Caller.of(request)?.refusal(capability);
		refusal && response.status(refusal.status).json({ error: { code: refusal.code, message: refusal.message } });
		return !!refusal;
	};
	app.get('/files/content/*', (request, response) => refused(request, response, 'files.read') || response.type('application/octet-stream').send('SECRET'));
	app.post('/files/operations', async (request, response) => {
		if (refused(request, response, 'files.write')) return;
		if (!String(request.headers['content-type']).startsWith('application/json')) return response.status(415).json({ error: { code: 'CONTENT_TYPE_UNSUPPORTED' } });
		let text = '';
		for await (const chunk of request) text += chunk;
		writes.push(text);
		response.json({ id: 'b1', outcome: 'completed', results: [] });
	});
	app.post(['/builds', '/builds/:id/cancel'], (request, response) => {
		if (refused(request, response, 'build.control')) return;
		builds.push(request.path);
		response.status(202).json({ build: { id: 'bld_1', state: 'running' } });
	});
	app.get('/events', (request, response) => {
		if (refused(request, response, 'events.subscribe')) return;
		const caller = Caller.of(request);
		response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' });
		const sources = caller?.allows('files.read') ?? true;
		for (const type of ['file.changed', 'build.ended', 'export.changed']) {
			if (sources || !/^(file|batch|export)\./.test(type)) response.write(`event: ${type}\ndata: {}\n\n`);
		}
		response.write('event: subscribed\ndata: {}\n\n');
		const release = caller?.ended(reason => {
			response.write(`event: access.ended\ndata: ${JSON.stringify({ reason })}\n\n`);
			response.end();
		});
		request.on('close', () => release?.());
	});
	app.use((request, response) => response.status(404).json({ error: { code: 'NOT_FOUND' } }));

	const server = app.listen(0, bind);
	await new Promise(resolve => server.once('listening', resolve));
	const port = server.address().port;
	const listening = await portable?.listen(app, { port, address: '127.0.0.1' });
	t.after(async () => {
		attachments.close('the case ended');
		await portable?.stop();
		server.closeAllConnections();
		await new Promise(resolve => server.close(resolve));
	});
	const ports = { api: port, preview: listening?.port };

	/**
	 * A request with exactly the headers given (`Host` defaults to the loopback one of the listener), answered as
	 * {status, headers, body}, the body parsed when it is JSON
	 */
	const send = (method, path, headers = {}, body, listener = 'api') =>
		new Promise((resolve, reject) => {
			const target = ports[listener];
			const sent = request({ host: '127.0.0.1', port: target, path, method, headers: { host: `127.0.0.1:${target}`, ...headers } }, response => {
				let text = '';
				response.setEncoding('utf8').on('data', chunk => (text += chunk));
				response.on('end', () => {
					let parsed = text;
					try {
						parsed = text ? JSON.parse(text) : void 0;
					} catch {
						// Not JSON: kept as text
					}
					resolve({ status: response.statusCode, headers: response.headers, body: parsed });
				});
			});
			sent.on('error', reject);
			sent.end(body);
		});

	/**
	 * Opens an event stream and collects its events; `until(type)` waits for one within a bound
	 */
	const stream = (path, headers = {}, listener = 'api') =>
		new Promise((resolve, reject) => {
			const events = [];
			const waiting = new Set();
			const target = ports[listener];
			const sent = request({ host: '127.0.0.1', port: target, path, headers: { host: `127.0.0.1:${target}`, ...headers } }, response => {
				let text = '';
				response.setEncoding('utf8').on('data', chunk => {
					text += chunk;
					for (const [, type, data] of text.matchAll(/event: (\S+)\ndata: (.*)\n\n/g)) events.push({ type, data: JSON.parse(data) });
					text = text.slice(text.lastIndexOf('\n\n') + 2);
					waiting.forEach(check => check());
				});
				const until = (type, ms = 3000) =>
					new Promise((done, failed) => {
						const timer = setTimeout(() => (waiting.delete(check), failed(new Error(`No ${type} event within ${ms} ms: ${JSON.stringify(events)}`))), ms);
						const check = () => {
							const found = events.find(event => event.type === type);
							if (!found) return;
							clearTimeout(timer);
							waiting.delete(check);
							done(found);
						};
						waiting.add(check);
						check();
					});
				resolve({ status: response.statusCode, headers: response.headers, events, until, close: () => sent.destroy() });
			});
			sent.on('error', reject);
			sent.end();
			t.after(() => sent.destroy());
		});

	const local = { authorization: `Local ${CREDENTIAL}` };

	/**
	 * Pairs a page of an origin: a local tool creates the code, the page redeems it
	 */
	const pair = async (from = UI) => {
		const { body: created } = await send('POST', '/pairing/codes', local);
		return (await send('POST', '/pairing', { origin: from, 'content-type': 'application/json' }, JSON.stringify({ code: created.code }))).body;
	};

	return {
		ports,
		api: `http://127.0.0.1:${ports.api}`,
		preview: listening?.preview,
		publics: listening?.publics,
		local,
		send,
		stream,
		pair,
		writes,
		builds,
		attach: headers => stream('/attach?kind=session', { ...local, ...headers })
	};
};
