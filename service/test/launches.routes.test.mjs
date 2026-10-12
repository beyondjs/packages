import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Caller } from '../host/pairing/caller.mjs';
import { Stage, backend } from '../../tests/launches/support/stage.mjs';

/**
 * What the routes of `beyond-launches/1` refuse, and the service that has none of them
 */

const code = answer => [answer.status, answer.body?.error?.code];

test('a service started without the launch setting mounts no route, claims no capability and starts nothing', async t => {
	const stage = await new Stage({ launch: null, targets: { server: backend('server') } }).start(t);
	assert.equal(stage.feature.enabled, false);
	assert.deepEqual(stage.feature.capabilities, {});
	assert.equal((await stage.request('GET', '/launches')).status, 404);
	assert.equal((await stage.launch('server', 'request-0001')).status, 404);
	assert.deepEqual(stage.events, []);

	const enabled = await new Stage({ targets: { server: backend('server') } }).start(t);
	assert.deepEqual(enabled.feature.capabilities, { launch: 1 });
});

test('a launch setting that cannot be used, or a service that decides nobody\'s access, fails the start', async t => {
	const relative = { node: { register: 'register.mjs', launcher: 'launcher.mjs' } };
	await assert.rejects(new Stage({ launch: relative }).start(t), /absolute path/);
	await assert.rejects(new Stage({ launch: {} }).start(t), /absolute path/);
	await assert.rejects(new Stage({ host: { bind: '0.0.0.0', pairing: void 0 } }).start(t), /decides who reaches it/);

	// A loopback service that does not pair cannot tell a page of another site or a local consumer from its clients
	await assert.rejects(new Stage({ host: { pairing: void 0 } }).start(t), /pairs browsers .* or verifies delegated grants/);
	await assert.rejects(new Stage({ host: { bind: '127.0.0.1', pairing: void 0 } }).start(t), /decides who reaches it/);

	// Pairing or delegated grants decide who reaches it, on any address
	const paired = await new Stage({ host: { bind: '0.0.0.0', pairing: { origins: [] } } }).start(t);
	assert.deepEqual(paired.feature.capabilities, { launch: 1 });
	const granted = await new Stage({ host: { bind: '0.0.0.0', pairing: void 0 }, environment: { BEYOND_AUTHORITY: '{}' } }).start(t);
	assert.deepEqual(granted.feature.capabilities, { launch: 1 });
	const local = await new Stage({ host: { pairing: void 0 }, environment: { BEYOND_AUTHORITY: '{}' } }).start(t);
	assert.deepEqual(local.feature.capabilities, { launch: 1 });
});

test('a service a launched process could not read launches nothing, and says why', async t => {
	const consumer = '"LAUNCH_CONSUMER_REFUSED"';
	const refused = async stage => {
		const { status, body } = await stage.launch('server', 'request-0001');
		return [status, body.error?.code, body.error?.details?.reason];
	};
	// Behind a public origin, on another address, or behind grants that let no loopback request through, a process
	// without the credential reads nothing: it would fail to load what it runs
	const targets = { server: backend('server') };
	const publicly = await new Stage({ targets, host: { pairing: { origins: [], public: 'https://space-{port}.forward.example' } } }).start(t);
	assert.deepEqual(await refused(publicly), [422, 'TARGET_NOT_LAUNCHABLE', 'LAUNCH_CONSUMER_REFUSED'], consumer);
	const elsewhere = await new Stage({ targets, host: { bind: '0.0.0.0', pairing: { origins: [], public: 'https://dev.example' } } }).start(t);
	assert.deepEqual(await refused(elsewhere), [422, 'TARGET_NOT_LAUNCHABLE', 'LAUNCH_CONSUMER_REFUSED'], consumer);
	const granted = await new Stage({ targets, host: { pairing: void 0 }, environment: { BEYOND_AUTHORITY: '{}' } }).start(t);
	assert.deepEqual(await refused(granted), [422, 'TARGET_NOT_LAUNCHABLE', 'LAUNCH_CONSUMER_REFUSED'], consumer);
	assert.deepEqual([publicly.events, elsewhere.events, granted.events], [[], [], []], 'nothing was launched');

	// Grants that let loopback requests through, as inside a project container, leave its processes readers
	const trusted = await new Stage({ targets, host: { pairing: void 0 }, environment: { BEYOND_AUTHORITY: '{}', BEYOND_TRUST_LOOPBACK: '1' } }).start(t);
	assert.equal((await trusted.launch('server', 'request-0001')).status, 202);
});

test('a launch request carries a request identifier and a JSON body that names a target', async t => {
	const stage = await new Stage({ targets: { server: backend('server') } }).start(t);
	const body = { application: 'fixture', target: 'server' };
	assert.deepEqual(code(await stage.request('POST', '/launches', { body })), [400, 'IDEMPOTENCY_KEY_REQUIRED']);
	assert.deepEqual(code(await stage.request('POST', '/launches', { body, key: 'short' })), [400, 'IDEMPOTENCY_KEY_INVALID']);
	assert.deepEqual(code(await stage.request('POST', '/launches', { body, key: 'with spaces 0001' })), [400, 'IDEMPOTENCY_KEY_INVALID']);
	const text = { 'content-type': 'text/plain' };
	assert.deepEqual(code(await stage.request('POST', '/launches', { body: JSON.stringify(body), key: 'request-0001', headers: text })), [415, 'CONTENT_TYPE_UNSUPPORTED']);
	for (const invalid of [{}, { application: 'fixture' }, { application: 'Fixture', target: 'server' }, { application: 'fixture', target: 7 }]) {
		assert.deepEqual(code(await stage.request('POST', '/launches', { body: invalid, key: 'request-0001' })), [400, 'BODY_INVALID'], JSON.stringify(invalid));
	}
	const large = { ...body, padding: 'x'.repeat(5000) };
	assert.deepEqual(code(await stage.request('POST', '/launches', { body: large, key: 'request-0001' })), [413, 'BODY_TOO_LARGE']);
	assert.deepEqual(stage.events, [], 'nothing was launched');
});

test('a target that is not launched here is refused with the reason, and the refusal leaves its identifier free', async t => {
	const frontend = { declared: { kind: 'frontend' }, entry: { specifier: '@fixture/web/main' }, environment: 'browser', open: { preview: '/preview/' } };
	const unresolved = { declared: { kind: 'backend' }, launch: { supported: false, reason: { code: 'TARGET_ENTRY_NOT_FOUND', message: 'No public module "./server"' } } };
	const targets = { web: frontend, unresolved, bun: backend('server', { runtime: 'bun' }), deno: backend('server', { runtime: 'deno' }) };
	const stage = await new Stage({ targets, environment: { BEYOND_DENO: '' } }).start(t);
	const refusal = async target => {
		const { status, body } = await stage.launch(target, `request-${target}-1`);
		return [status, body.error.code, body.error.details?.reason];
	};
	assert.deepEqual(await refusal('web'), [422, 'TARGET_NOT_LAUNCHABLE', 'TARGET_FRONTEND']);
	assert.deepEqual(await refusal('unresolved'), [422, 'TARGET_NOT_LAUNCHABLE', 'TARGET_ENTRY_NOT_FOUND']);
	assert.deepEqual(await refusal('bun'), [422, 'TARGET_NOT_LAUNCHABLE', 'TARGET_RUNTIME_UNSUPPORTED']);
	assert.deepEqual(await refusal('deno'), [422, 'TARGET_NOT_LAUNCHABLE', 'DENO_NOT_CONFIGURED']);
	assert.deepEqual(await refusal('missing'), [404, 'TARGET_NOT_FOUND', undefined]);
	const application = await stage.request('POST', '/launches', { body: { application: 'other', target: 'web' }, key: 'request-other' });
	assert.deepEqual(code(application), [404, 'APPLICATION_NOT_FOUND']);
	assert.match((await stage.launch('web', 'request-web-2')).body.error.message, /opened as a document/);
	assert.deepEqual(stage.events, [], 'nothing was launched');

	// Without the development extension there is no catalog to resolve a target with
	const bare = await new Stage({ targets: { server: backend('server') }, catalog: null }).start(t);
	assert.deepEqual((await bare.launch('server', 'request-0001')).body.error.details, { reason: 'APPLICATIONS_UNAVAILABLE' });

	// The identifier of a refused request is decided again: once the target can be launched, the same request launches it
	let declared = unresolved;
	const changing = await new Stage({ targets: { api: () => Promise.resolve(structuredClone(declared)) } }).start(t);
	assert.equal((await changing.launch('api', 'request-0001')).status, 422);
	declared = backend('silent');
	assert.equal((await changing.launch('api', 'request-0001')).status, 202);
});

test('only the launches of this service are read or stopped', async t => {
	const stage = await new Stage({ targets: { server: backend('server') } }).start(t);
	for (const path of ['/launches/lch_000000000000000000000000', '/launches/lch_000000000000000000000000/output', '/launches/42', '/launches/..%2Fsession']) {
		assert.deepEqual(code(await stage.request('GET', path)), [404, 'LAUNCH_NOT_FOUND'], path);
	}
	assert.deepEqual(code(await stage.request('POST', '/launches/lch_000000000000000000000000/stop')), [404, 'LAUNCH_NOT_FOUND']);
	assert.deepEqual(code(await stage.request('POST', '/launches/1234/stop', { body: 'x', headers: { 'content-type': 'text/plain' } })), [415, 'CONTENT_TYPE_UNSUPPORTED']);

	const { body } = await stage.launch('server', 'request-0001');
	for (const after of ['-1', 'x', '1.5']) {
		assert.deepEqual(code(await stage.request('GET', `/launches/${body.launch.id}/output?after=${after}`)), [400, 'OPTION_INVALID'], after);
	}
	assert.deepEqual((await stage.request('GET', '/launches')).body.launches.map(launch => launch.id), [body.launch.id]);
});

test('a caller without the capability of a route is refused as the policy decided', async t => {
	const consumer = app => app.use((request, response, next) => (new Caller('consumer', { refusal: Caller.CREDENTIAL }).attach(request), next()));
	const stage = await new Stage({ targets: { server: backend('server') }, middleware: consumer }).start(t);
	assert.deepEqual(code(await stage.launch('server', 'request-0001')), [401, 'CREDENTIAL_REQUIRED']);
	assert.deepEqual(code(await stage.request('POST', '/launches/lch_000000000000000000000000/stop')), [401, 'CREDENTIAL_REQUIRED']);
	assert.deepEqual(stage.events, []);

	const paired = app => app.use((request, response, next) => (new Caller('paired').attach(request), next()));
	const page = await new Stage({ targets: { server: backend('server') }, middleware: paired }).start(t);
	assert.equal((await page.launch('server', 'request-0001')).status, 202);
});

test('a host that gives no API origin launches with the origin the request reached', async t => {
	const stage = await new Stage({ targets: { server: backend('server') }, origins: false }).start(t);
	const { status, body } = await stage.launch('server', 'request-0001');
	assert.equal(status, 202);
	await stage.until(body.launch.id, launch => launch.state === 'ready');
	const line = (await stage.output(body.launch.id)).find(text => text.startsWith('environment '));
	assert.equal(JSON.parse(line.slice('environment '.length)).BEE_URL, stage.origin);
});
