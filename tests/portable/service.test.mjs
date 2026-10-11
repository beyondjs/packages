import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Served } from './support/served.mjs';

const UI = 'https://ui.example';
const EVIL = 'https://evil.example';
const JSON_TYPE = { 'content-type': 'application/json' };
const BROWSER = 'target=browser&format=esm&env=development&min=false&sourcemap=inline';
const NODE = 'target=node&format=esm&env=development&min=false&sourcemap=inline';
const TEXT = '/m/@portable/app@1.0.0/modules/text';
const code = answer => [answer.status, answer.body?.error?.code];

const served = new Served();
before(() => served.start({ pairing: { origins: [UI] } }), { timeout: 600000 });
after(() => served.stop(), { timeout: 120000 });

test('the session describes both listeners and what the service implements, and never the credential', async () => {
	const { service, capabilities } = served.session;
	assert.match(service.preview, /^http:\/\/127\.0\.0\.1:\d+$/);
	assert.notEqual(service.preview, served.origin);
	for (const name of ['state', 'installation', 'files', 'events', 'builds', 'declarations', 'selection', 'preview', 'pairing', 'exports']) {
		assert.equal(capabilities[name], 1, name);
	}
	assert.equal(capabilities.ui, undefined, 'no interface build was given');

	const authorization = served.headers.authorization;
	assert.match(authorization, /^Local [A-Za-z0-9_-]{43}$/);
	const records = join(served.root, '..', 'home', 'services');
	const record = JSON.parse(readFileSync(join(records, readdirSync(records).find(name => name.endsWith('.json'))), 'utf8'));
	assert.equal(statSync(record.credential).mode & 0o777, 0o600, 'readable by its user only');
	assert.equal(JSON.stringify(served.session).includes(authorization.slice(6)), false);
});

test('a local consumer reads without the credential, and reads no source and changes nothing', async () => {
	for (const path of ['/session', '/state', `${TEXT}?${NODE}`, '/resolution.json']) assert.equal((await served.send('GET', path)).status, 200, path);
	for (const [method, path] of [['GET', '/files/tree'], ['GET', '/files/content/app/.env'], ['GET', '/declarations/@portable/app/text'], ['POST', '/builds'], ['GET', '/exports'], ['POST', '/pairing/codes']]) {
		assert.deepEqual(code(await served.send(method, path, { headers: JSON_TYPE, body: method === 'POST' ? '{}' : void 0 })), [401, 'CREDENTIAL_REQUIRED'], `${method} ${path}`);
	}
});

test('a page of another site reads nothing and its preflight is refused, its text body never runs', async () => {
	for (const path of ['/session', '/files/content/app/.env', `${TEXT}?${BROWSER}`]) {
		const refused = await served.send('GET', path, { headers: { origin: EVIL } });
		assert.deepEqual(code(refused), [401, 'PAIRING_REQUIRED'], path);
		assert.equal(refused.headers['access-control-allow-origin'], undefined, path);
	}
	const preflight = await served.send('OPTIONS', '/files/content/app/a.ts', { headers: { origin: EVIL, 'access-control-request-method': 'PUT' } });
	assert.deepEqual(Object.keys(preflight.headers).filter(name => name.startsWith('access-control-')), []);

	const batch = JSON.stringify({ mutations: [{ operation: 'write', path: 'app/injected.ts', expected: 'absent', content: 'x' }] });
	assert.equal((await served.send('POST', '/files/operations', { headers: { origin: EVIL, 'content-type': 'text/plain' }, body: batch })).status, 401);
	assert.equal(existsSync(join(served.root, 'app', 'injected.ts')), false, 'the disk is unchanged');
});

test('the development extension parses a batch only as JSON, and refuses .git and .beyond at any depth', async () => {
	const batch = JSON.stringify({ mutations: [{ operation: 'write', path: 'app/written.ts', expected: 'absent', content: 'export const written = 1;\n' }] });
	assert.deepEqual(code(await served.send('POST', '/files/operations', { headers: { ...served.headers, 'content-type': 'text/plain' }, body: batch })), [415, 'CONTENT_TYPE_UNSUPPORTED']);
	assert.equal(existsSync(join(served.root, 'app', 'written.ts')), false);
	const completed = await served.send('POST', '/files/operations', { headers: { ...served.headers, ...JSON_TYPE }, body: batch });
	assert.equal(completed.body.outcome, 'completed', JSON.stringify(completed.body));
	assert.ok(existsSync(join(served.root, 'app', 'written.ts')));

	for (const path of ['app/.git/config', 'app/sub/.GIT/hooks/pre-commit', 'app/.beyond/state.json', 'app/x/.Beyond/y']) {
		const refused = await served.send('PUT', `/files/content/${path}`, { headers: { ...served.headers, 'if-none-match': '*' }, body: 'x' });
		assert.deepEqual(code(refused), [403, 'PATH_FORBIDDEN'], path);
	}
	assert.deepEqual(code(await served.send('POST', '/builds', { headers: { ...served.headers, 'content-type': 'application/x-www-form-urlencoded' } })), [415, 'CONTENT_TYPE_UNSUPPORTED']);
});

test('a name made to resolve to this machine is refused on both listeners, preflights included', async () => {
	for (const listener of ['api', 'preview']) {
		const host = `evil.example:${served.port(listener)}`;
		for (const [method, path, headers] of [['GET', `${TEXT}?${BROWSER}`], ['GET', '/events'], ['GET', '/preview/'], ['OPTIONS', '/session', { origin: UI, 'access-control-request-method': 'GET' }]]) {
			assert.deepEqual(code(await served.send(method, path, { headers: { ...headers, host }, listener })), [403, 'HOST_REFUSED'], `${listener} ${method} ${path}`);
		}
	}
});

test('the preview listener serves the preview and browser modules only, to allowed origins across sites', async () => {
	const page = await served.send('GET', '/preview/?entry=%40portable%2Fapp%2Fmain', { listener: 'preview' });
	assert.equal(page.status, 200);
	assert.match(page.body, /<script type="module"/);
	const module = await served.send('GET', `${TEXT}?${BROWSER}`, { listener: 'preview', headers: { origin: UI } });
	assert.equal(module.status, 200);
	assert.match(module.body, /Hello/);
	assert.equal(module.headers['access-control-allow-origin'], UI);
	assert.equal((await served.send('GET', `${TEXT}?${BROWSER}`, { listener: 'preview', headers: { origin: EVIL } })).headers['access-control-allow-origin'], undefined, 'never "*"');
	assert.deepEqual(code(await served.send('GET', `${TEXT}?${NODE}`, { listener: 'preview' })), [403, 'TARGET_REFUSED']);
	for (const [method, path] of [['GET', '/files/tree'], ['GET', '/files/content/app/.env'], ['GET', '/session'], ['POST', '/pairing'], ['GET', '/development/selection']]) {
		assert.deepEqual(code(await served.send(method, path, { listener: 'preview', headers: { ...served.headers, ...JSON_TYPE }, body: method === 'POST' ? '{}' : void 0 })), [404, 'NOT_FOUND'], `${method} ${path}`);
	}
});

test('a request through a proxy or a tunnel is never a local consumer, and the preview refuses other sites\' subresources', async () => {
	const proxy = { 'x-forwarded-for': '203.0.113.9' };
	for (const path of [`${TEXT}?${NODE}`, '/session']) {
		assert.deepEqual(code(await served.send('GET', path, { headers: proxy })), [401, 'CREDENTIAL_REQUIRED'], path);
	}
	const attach = await served.stream('/attach?kind=session', { headers: proxy });
	assert.equal(attach.status, 401, 'a tunnel does not keep the service alive');
	attach.close();
	assert.equal((await served.send('GET', `${TEXT}?${NODE}`)).status, 200, 'the same process without the header reads');

	// A classic script of another site would run the module with a shim of its own; its own pages load it
	const script = { 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'no-cors', 'sec-fetch-dest': 'script' };
	const system = `${TEXT}?target=browser&format=system&env=development&min=false&sourcemap=inline`;
	assert.deepEqual(code(await served.send('GET', system, { listener: 'preview', headers: script })), [403, 'SITE_REFUSED']);
	assert.equal((await served.send('GET', `${TEXT}?${BROWSER}`, { listener: 'preview', headers: { ...script, 'sec-fetch-site': 'same-origin' } })).status, 200);
	assert.equal((await served.send('GET', `${TEXT}?${BROWSER}`, { listener: 'preview', headers: { ...script, 'sec-fetch-mode': 'cors', origin: UI } })).status, 200);
	const opened = await served.send('GET', '/preview/?entry=%40portable%2Fapp%2Fmain', { listener: 'preview', headers: { 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document' } });
	assert.equal(opened.status, 200, 'a preview opened from another site');
});

test('a paired page reaches the development routes, sees source events, and its streams end when its pairing ends', async () => {
	const { code: pairing } = await served.pairing.code();
	const paired = await served.send('POST', '/pairing', { headers: { origin: UI, ...JSON_TYPE }, body: JSON.stringify({ code: pairing }) });
	assert.equal(paired.status, 201, JSON.stringify(paired.body));
	const headers = { origin: UI, authorization: `Bearer ${paired.body.token}` };
	const tree = await served.send('GET', '/files/tree?path=app', { headers });
	assert.equal(tree.status, 200);
	assert.equal(tree.headers['access-control-allow-origin'], UI);
	assert.ok(tree.body.entries.some(({ path }) => path === 'app/.env'));

	const events = await served.stream('/events', { headers });
	const previewed = await served.stream('/events', { listener: 'preview' });
	await events.until('subscribed');
	await previewed.until('subscribed');
	const written = await served.send('PUT', '/files/content/app/edited.ts', { headers: { ...headers, 'if-none-match': '*' }, body: 'export const edited = true;\n' });
	assert.equal(written.body.outcome, 'completed', JSON.stringify(written.body));
	await events.until(event => event.type === 'file.created' && event.data.path === 'app/edited.ts');
	assert.equal(previewed.events.some(({ type }) => /^(file|batch|export)\./.test(type)), false, 'the preview listener never says a source changed');

	await served.pairing.revoke(paired.body.pairing.id);
	assert.equal((await events.until('access.ended')).data.reason, 'PAIRING_REVOKED');
	assert.deepEqual(code(await served.send('GET', '/files/tree', { headers })), [401, 'PAIRING_REVOKED']);
	previewed.close();
});

test('the root package and a member are exported with what their publication would hold', async () => {
	const created = await served.send('POST', '/exports', { headers: { ...served.headers, ...JSON_TYPE }, body: JSON.stringify({ packages: ['app'] }) });
	assert.equal(created.status, 201, JSON.stringify(created.body));
	const [app] = created.body.export.packages;
	assert.ok(app.files.includes('package.json') && app.files.includes('text/index.ts'), JSON.stringify(app.files));
	assert.deepEqual(app.excluded.secrets, ['.env']);
	assert.match(app.digest, /^[0-9a-f]{64}$/);
	assert.deepEqual(code(await served.send('POST', '/exports', { headers: { ...served.headers, ...JSON_TYPE }, body: JSON.stringify({ packages: ['.'] }) })), [400, 'EXPORT_PACKAGE_INVALID'], 'a beyond.json root holds no package.json');
});
