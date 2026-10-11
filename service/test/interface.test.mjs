import { test } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { Interface } from '../host/interface.mjs';

const BUILD = fileURLToPath(new URL('./fixtures/interface/build', import.meta.url));

const mount = async (t, build = BUILD) => {
	const app = express();
	new Interface(build).setup(app);
	app.use((request, response) => response.status(404).json({ error: { code: 'NOT_FOUND' } }));
	const server = app.listen(0, '127.0.0.1');
	await new Promise(resolve => server.once('listening', resolve));
	t.after(() => {
		server.closeAllConnections();
		return new Promise(resolve => server.close(resolve));
	});
	const { port } = server.address();
	return (method, path) =>
		new Promise((resolve, reject) => {
			const sent = request({ host: '127.0.0.1', port, path, method }, response => {
				let text = '';
				response.setEncoding('utf8').on('data', chunk => (text += chunk));
				response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, text }));
			});
			sent.on('error', reject);
			sent.end();
		});
};

test('the page of the interface is served at /ui/ with a content security policy and revalidated', async t => {
	const send = await mount(t);
	const redirect = await send('GET', '/ui?core=x');
	assert.equal(redirect.status, 308);
	assert.equal(redirect.headers.location, 'ui/?core=x', 'relative, as the addresses of the build are');

	const page = await send('GET', '/ui/');
	assert.equal(page.status, 200);
	assert.match(page.headers['content-type'], /^text\/html/);
	assert.equal(page.headers['cache-control'], 'no-cache');
	assert.equal(page.headers['x-content-type-options'], 'nosniff');
	assert.equal(page.headers['content-security-policy'], Interface.POLICY);
	assert.match(page.headers['content-security-policy'], /script-src 'self'/);
	assert.match(page.headers['content-security-policy'], /frame-ancestors 'none'/);
	assert.match(page.text, /<main id="root">/);
});

test('files of the build are served with their media type, hashed assets cached for a year', async t => {
	const send = await mount(t);
	const script = await send('GET', '/ui/assets/index-9b8e7d.js');
	assert.equal(script.status, 200);
	assert.match(script.headers['content-type'], /javascript/);
	assert.equal(script.headers['cache-control'], 'public, max-age=31536000, immutable');
	assert.match((await send('GET', '/ui/assets/index-3f2a1c.css')).headers['content-type'], /^text\/css/);
	const icon = await send('GET', '/ui/icon.svg');
	assert.match(icon.headers['content-type'], /^image\/svg\+xml/);
	assert.equal(icon.headers['cache-control'], 'no-cache');
	assert.equal((await send('HEAD', '/ui/assets/index-9b8e7d.js')).status, 200);
});

test('a route of the application answers the page; a missing file, a listing or a path outside the build never does', async t => {
	const send = await mount(t);
	for (const path of ['/ui/projects/one', '/ui/assets/', '/ui/assets']) {
		const answered = await send('GET', path);
		assert.equal(answered.status, 200, path);
		assert.match(answered.text, /<main id="root">/, `${path} is the page, never a listing`);
	}
	const missing = await send('GET', '/ui/assets/missing.js');
	assert.equal(missing.status, 404);
	assert.doesNotMatch(missing.text, /<main/);

	for (const path of ['/ui/..%2F..%2FREADME.md', '/ui/%2e%2e/%2e%2e/README.md', '/ui/../README.md']) {
		const answered = await send('GET', path);
		assert.doesNotMatch(answered.text, /Interface fixture/, path);
	}
	assert.equal((await send('POST', '/ui/')).status, 404, 'only GET and HEAD');
});

test('an installation under a dot directory serves its page and routes, as the default one under ~/.local does', async t => {
	const home = mkdtempSync(join(tmpdir(), 'beyond-interface-'));
	t.after(() => rmSync(home, { recursive: true, force: true }));
	const build = join(home, '.local', 'share', 'beyond-cli', 'ui');
	cpSync(BUILD, build, { recursive: true });
	const send = await mount(t, build);
	for (const path of ['/ui/', '/ui/connections']) {
		const answer = await send('GET', path);
		assert.equal(answer.status, 200, path);
		assert.match(answer.text, /<html/i, path);
	}
	// A dot file inside the build is still never served: the request's own path is what is checked
	writeFileSync(join(build, '.secret'), 'NOT-FOR-PAGES');
	const hidden = await send('GET', '/ui/.secret');
	assert.ok(!hidden.text.includes('NOT-FOR-PAGES'), 'the content of a dot file never leaves the service');
});

test('a directory without a page cannot be served, which fails the start of the service', t => {
	const empty = mkdtempSync(join(tmpdir(), 'beyond interface '));
	t.after(() => rmSync(empty, { recursive: true, force: true }));
	assert.throws(() => new Interface(empty), /holds no index\.html/);
	assert.deepEqual(new Interface(BUILD).capabilities, { ui: 1 });
});
