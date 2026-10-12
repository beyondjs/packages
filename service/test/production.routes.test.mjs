import { test } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import express from 'express';
import { Operations } from '../host/operations/operations.mjs';
import { OperationRoutes } from '../host/operations/routes.mjs';
import { Feature } from '../host/production/index.mjs';
import { Modules } from '../host/production/modules.mjs';
import { Registry } from '../../tests/production/support/registry.mjs';
import { Exports, Publication, settings } from '../../tests/production/support/modules.mjs';
import { copy, until } from '../../tests/production/support/workspaces.mjs';
import { delivery as stand, description } from '../../tests/production/support/page.mjs';

const JSON_TYPE = { 'content-type': 'application/json' };

/**
 * The production feature mounted as the host mounts it, over a copy of the packages fixture: real operations, a
 * stand-in registry, stand-ins for Packages' modules and for the shared objects of the development extension
 */
const mount = async (t, { extension = true, environment = {}, read } = {}) => {
	const { root, write, settle } = copy(t, 'packages');
	write('packages/ui/.env', 'NOT_A_REAL_SECRET=1\n');
	const registry = await new Registry().start();
	t.after(() => registry.stop());
	const operations = new Operations({ root });
	await operations.start();
	settle(() => operations.idle());

	const declarations = { read: read ?? (async specifier => (specifier.startsWith('@production/beyond@') ? { code: 'declare module…' } : Promise.reject(Object.assign(new Error('none'), { code: 'DECLARATION_NOT_FOUND' })))) };
	const shared = extension ? { files: {}, declarations } : {};
	const services = { get: name => shared[name] };
	const workspace = { ...stand(), published: async () => [{ name: '@production/beyond', version: '1.0.0', subpath: './main', path: `${root}/packages/beyond` }] };
	const modules = new Modules({ publication: async () => ({ Publication, Exports }), settings: settings(registry.origin), development: async () => ({ Preview: class { describe = async () => description() } }) });
	const feature = new Feature({ root, settings: { root }, workspace, operations, services, environment }, { modules });
	await feature.start();

	const app = express();
	new OperationRoutes(operations).setup(app);
	feature.setup(app);
	app.use((request, response) => response.status(404).json({ error: { code: 'NOT_FOUND', message: request.path } }));
	const server = app.listen(0, '127.0.0.1');
	await new Promise(resolve => server.once('listening', resolve));
	t.after(() => {
		server.closeAllConnections();
		return new Promise(resolve => server.close(resolve));
	});
	const { port } = server.address();
	const send = (method, path, headers = {}, body) =>
		new Promise((resolve, reject) => {
			const sent = request({ host: '127.0.0.1', port, path, method, headers }, response => {
				let text = '';
				response.setEncoding('utf8').on('data', chunk => (text += chunk));
				response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body: text ? JSON.parse(text) : void 0 }));
			});
			sent.on('error', reject);
			sent.end(body);
		});
	const follow = async location => {
		await until(async () => (await send('GET', location)).body.operation.state !== 'running');
		return (await send('GET', location)).body.operation;
	};
	return { root, send, follow, feature, registry };
};

test('the feature claims production only with the development extension and without delegated grants', async t => {
	assert.deepEqual((await mount(t)).feature.capabilities, { production: 1 });
	const { feature, send } = await mount(t, { extension: false });
	assert.deepEqual(feature.capabilities, {});
	assert.deepEqual([(await send('GET', '/production/packages/packages%2Fcore')).status, (await send('GET', '/production/exports')).status], [404, 404], 'nothing answers');
	assert.deepEqual((await mount(t, { environment: { BEYOND_AUTHORITY: 'https://authority.example' } })).feature.capabilities, {});
});

test('the preflight says what a publication would hold and what prevents it', async t => {
	const { send, registry } = await mount(t);
	const answer = await send('GET', '/production/packages/packages%2Fui');
	assert.equal(answer.status, 200);
	assert.equal(answer.headers['cache-control'], 'no-store');
	const preflight = answer.body;
	assert.deepEqual([preflight.protocol, preflight.member, preflight.name, preflight.version, preflight.private], ['beyond-production/1', 'packages/ui', '@production/ui', '1.2.0', false]);
	assert.deepEqual(preflight.publication, { form: 'npm', diagnostics: [] });
	assert.deepEqual(preflight.registry, { url: registry.origin, source: 'configuration', access: 'public', tag: 'latest', declared: ['access'] });
	assert.deepEqual(preflight.files.list, ['dist/index.d.ts', 'dist/index.js', 'package.json', 'src/index.ts']);
	assert.deepEqual(preflight.files.excluded.secrets, ['.env']);
	const root = preflight.exports.find(({ subpath }) => subpath === '.');
	assert.deepEqual([root.target, root.included, root.types], ['./dist/index.js', true, { state: 'included', provenance: 'package', file: './dist/index.d.ts' }]);
	const codes = preflight.findings.map(({ code, severity }) => `${severity}:${code}`);
	for (const expected of ['error:EXPORT_TARGET_EXCLUDED', 'error:DEPENDENCY_WORKSPACE_PROTOCOL', 'info:DEPENDENCY_MEMBER', 'warning:SECRETS_EXCLUDED', 'warning:SCRIPTS_NOT_RUN']) assert.ok(codes.includes(expected), `${expected} in ${codes}`);
	assert.equal(preflight.ready, false);
	assert.deepEqual(preflight.dependencies.map(({ name, member }) => [name, member]), [['@production/core', 'packages/core'], ['@production/private-util', 'packages/private-util']]);

	const core = (await send('GET', '/production/packages/%40production%2Fcore')).body;
	assert.deepEqual([core.member, core.ready, core.registry.access], ['packages/core', true, 'restricted'], 'a scoped package is restricted unless it says otherwise');
	const beyond = (await send('GET', '/production/packages/packages%2Fbeyond')).body;
	assert.deepEqual([beyond.publication.form, beyond.exports[0].subpath, beyond.exports[0].types.state], ['source', './main', 'generated']);
	assert.ok((await send('GET', '/production/packages/packages%2Fprivate-util')).body.findings.some(({ code, severity }) => code === 'PACKAGE_PRIVATE' && severity === 'error'));
	const unknown = await send('GET', '/production/packages/packages%2Fnone');
	assert.deepEqual([unknown.status, unknown.body.error.code], [404, 'MEMBER_NOT_FOUND']);
});

test('an archive, its status and a publication are operations; their requests are checked first', async t => {
	const { send, follow, registry } = await mount(t);
	const packing = await send('POST', '/production/packages/packages%2Fcore/archives', { 'idempotency-key': 'pack-request-0001' });
	assert.equal(packing.status, 202);
	assert.equal(packing.headers.location, `/operations/${packing.body.operation.id}`);
	const packed = await follow(packing.headers.location);
	assert.equal(packed.kind, 'production.pack');
	const { archive } = packed.result;
	assert.deepEqual([archive.name, archive.version, archive.member], ['@production/core', '1.0.0', 'packages/core']);
	const repeated = await send('POST', '/production/packages/packages%2Fcore/archives', { 'idempotency-key': 'pack-request-0001' });
	assert.deepEqual([repeated.status, repeated.body.operation.id], [200, packed.id], 'the same request identifier, the same operation');

	const checking = await send('POST', '/production/packages/packages%2Fcore/status', JSON_TYPE, JSON.stringify({ archive: archive.id }));
	const checked = await follow(checking.headers.location);
	assert.deepEqual([checked.kind, checked.result.status.state, checked.result.status.registry], ['production.status', 'not-published', registry.origin]);

	const confirm = { name: '@production/core', version: '1.0.0', registry: registry.origin };
	const publish = (body, headers = { ...JSON_TYPE, 'idempotency-key': 'publish-request-0001' }) => send('POST', '/production/packages/packages%2Fcore/publish', headers, JSON.stringify(body));
	const body = { archive: archive.id, registry: registry.origin, access: 'public', confirm };
	// One rule for every feature of the host: missing, and malformed, are refused alike
	assert.deepEqual([(await publish(body, JSON_TYPE)).status, (await publish(body, JSON_TYPE)).body.error.code], [400, 'IDEMPOTENCY_KEY_REQUIRED']);
	for (const key of ['short', 'with spaces 0001', 'tilde~0000000']) {
		const malformed = await publish(body, { ...JSON_TYPE, 'idempotency-key': key });
		assert.deepEqual([malformed.status, malformed.body.error.code], [400, 'IDEMPOTENCY_KEY_INVALID'], key);
	}
	const optional = await send('POST', '/production/packages/packages%2Fcore/archives', { 'idempotency-key': 'short' });
	assert.deepEqual([optional.status, optional.body.error.code], [400, 'IDEMPOTENCY_KEY_INVALID'], 'an optional identifier is held to the rule as well');
	assert.equal((await publish({ ...body, confirm: { ...confirm, version: '1.0.1' } })).body.error.code, 'CONFIRMATION_MISMATCH');
	assert.equal((await publish({ ...body, confirm: { ...confirm, registry: 'https://registry.npmjs.org' } })).status, 422, 'a confirmation of another registry');
	assert.equal((await publish({ ...body, access: 'everyone' })).body.error.code, 'REQUEST_INVALID');
	assert.equal((await publish({ ...body, archive: 'arc_ffffffffffffffffffffffff' })).body.error.code, 'ARCHIVE_NOT_FOUND');
	assert.equal((await publish({ ...body, registry: 'file:///tmp/registry' })).body.error.code, 'REQUEST_INVALID');
	assert.deepEqual(registry.published, [], 'nothing was published');
	const text = await send('POST', '/production/packages/packages%2Fcore/status', { 'content-type': 'text/plain' }, '{}');
	assert.deepEqual([text.status, text.body.error.code], [415, 'CONTENT_TYPE_UNSUPPORTED']);
});

test('a web export is an operation of its own request identifier, and the exports are listed', async t => {
	const { send, follow } = await mount(t);
	const body = JSON.stringify({ application: 'site', target: 'web', destination: 'dist/web', entry: '@site/web/main' });
	assert.equal((await send('POST', '/production/exports', JSON_TYPE, body)).body.error.code, 'IDEMPOTENCY_KEY_REQUIRED');
	const invalid = await send('POST', '/production/exports', { ...JSON_TYPE, 'idempotency-key': 'export-request-0000' }, JSON.stringify({ application: 'site', target: 'web', destination: '../out' }));
	assert.deepEqual([invalid.status, invalid.body.error.code], [400, 'EXPORT_DESTINATION_INVALID']);

	const started = await send('POST', '/production/exports', { ...JSON_TYPE, 'idempotency-key': 'export-request-0001' }, body);
	assert.equal(started.status, 202);
	const ended = await follow(started.headers.location);
	assert.equal(ended.state, 'succeeded', JSON.stringify(ended.error));
	const listed = (await send('GET', '/production/exports')).body;
	assert.deepEqual([listed.protocol, listed.exports.map(({ id }) => id)], ['beyond-production/1', [ended.result.export.id]]);
	assert.equal((await send('GET', `/production/exports/${ended.result.export.id}`)).body.export.destination, 'dist/web');
	assert.equal((await send('GET', '/production/exports/exp_..')).status, 404);
});

test('the preflight waits for a generated declaration within BEYOND_DECLARATION_TIMEOUT, and says it was not produced', async t => {
	const { send } = await mount(t, { environment: { BEYOND_DECLARATION_TIMEOUT: '200' }, read: () => new Promise(() => void 0) });
	const started = Date.now();
	const { status, body } = await send('GET', '/production/packages/packages%2Fbeyond');
	assert.equal(status, 200);
	assert.deepEqual([body.exports[0].types.state, body.exports[0].types.code], ['unknown', 'DECLARATION_TIMEOUT']);
	assert.ok(Date.now() - started < 10000, 'the bound ended the wait');
});
