/**
 * Integration: the preflight of an installation on the real host, over a copy of `fixtures/hello` (the declarations of
 * the suite's React Hello application) whose Widgets packages only the toolchain supplies (`fixtures/supplied`), with an
 * in-process registry that publishes React and nothing of Widgets (`fixtures/README.md`). The preflight names each
 * blocker before an installation is offered, the installation then fails as it predicted, and declaring the packages
 * as members, one of the routes it gives, clears it. Run from the Packages directory under BEE Node with BEE_URL and
 * WATCHERS_URL: `node --import "$BEE_NODE_DIR/register.mjs" --test tests/dependencies/hello.test.mjs`.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Scenario } from './support/served.mjs';

const SUPPLIED = fileURLToPath(new URL('./fixtures/supplied/', import.meta.url));
const scenario = new Scenario('hello');

before(async () => {
	await scenario.start({ releases: ['react@19.1.1', 'react-dom@19.1.1', 'scheduler@0.26.0'], supplied: ['widgets', 'react-19-widgets'] });
});
after(async () => {
	process.env.BEYOND_HOST_LOG === '1' && console.log(scenario.log);
	await scenario.stop();
});

const preflight = async () => {
	const { operation } = await scenario.run('/dependencies/preflight', {});
	assert.equal(operation.state, 'succeeded', JSON.stringify(operation));
	return operation.result;
};

test('the inventory lists what the toolchain supplies as supplied, never as a member or an installed node', { timeout: 300000 }, async () => {
	const { body } = await scenario.request('GET', '/dependencies');
	const adapter = body.nodes.find(({ name }) => name === '@beyond-js/react-19-widgets');
	assert.equal(adapter.key, 'supplied:@beyond-js/react-19-widgets@1.0.0');
	assert.deepEqual([adapter.status, adapter.source.kind, adapter.version], ['supplied', 'supplied', '1.0.0']);
	assert.deepEqual(adapter.declared, [{ importer: 'app', range: '^1.0.0', type: 'prod' }]);
	assert.deepEqual(body.members.map(({ id }) => id), ['app']);
});

test('the preflight names the declarations only the toolchain supplies before an installation is offered', { timeout: 300000 }, async () => {
	const result = await preflight();
	assert.equal(result.ready, false);
	assert.deepEqual(result.counts, { declared: 4, available: 2, blocked: 2, unavailable: 0, skipped: 0, unverified: 0 });
	const adapter = result.dependencies.find(({ name }) => name === '@beyond-js/react-19-widgets');
	assert.deepEqual([adapter.importer, adapter.range, adapter.status, adapter.source], ['app', '^1.0.0', 'blocked', 'supplied']);
	assert.equal(adapter.finding.code, 'PACKAGE_NOT_FOUND');
	assert.deepEqual(adapter.finding.supplied, { name: '@beyond-js/react-19-widgets', version: '1.0.0' });
	assert.match(adapter.finding.message, /only the toolchain supplies/);
	assert.match(adapter.finding.message, /installed graph and a clean CI machine cannot use that source/);
	assert.equal(adapter.finding.recovery.length, 3, 'a member, a registry that holds it, or development without an installed graph');
	assert.equal(result.dependencies.find(({ name }) => name === '@beyond-js/widgets').finding.code, 'PACKAGE_NOT_FOUND');
	assert.equal(result.dependencies.find(({ name }) => name === 'react').status, 'available');
	assert.throws(() => scenario.read('beyond-lock.json'), { code: 'ENOENT' });

	// What the preflight predicted is what an installation finds: GRAPH_INCOMPLETE, PACKAGE_NOT_FOUND through the app
	const installed = await scenario.request('POST', '/installation', { body: {} });
	assert.equal(installed.body.valid, false);
	const found = installed.body.diagnostics.map(({ code }) => code);
	assert.deepEqual([found[0], found.includes('PACKAGE_NOT_FOUND')], ['GRAPH_INCOMPLETE', true]);
	assert.ok(installed.body.diagnostics.some(({ message }) => /@beyond-js\/react-19-widgets/.test(message) && /workspace:app/.test(message)));
	assert.throws(() => scenario.read('beyond-lock.json'), { code: 'ENOENT' }, 'nothing was installed');
});

test('declaring the supplied packages as members clears the preflight, and the workspace installs', { timeout: 300000 }, async () => {
	for (const name of ['widgets', 'react-19-widgets']) {
		const content = readFileSync(`${SUPPLIED}${name}/package.json`, 'utf8');
		const path = `/files/content/vendor/${name}/package.json`;
		const created = await scenario.request('PUT', path, { raw: content, headers: { 'content-type': 'application/octet-stream', 'if-none-match': '*' } });
		assert.equal(created.body.outcome, 'completed', JSON.stringify(created.body));
	}
	const read = await fetch(`${scenario.origin}/files/content/beyond.json`);
	const declaration = JSON.stringify({ packages: ['app', 'vendor/widgets', 'vendor/react-19-widgets'] }, null, '\t');
	const written = await scenario.request('PUT', '/files/content/beyond.json', { raw: declaration, headers: { 'content-type': 'application/octet-stream', 'if-match': read.headers.get('etag') } });
	assert.equal(written.body.outcome, 'completed');

	const result = await preflight();
	assert.equal(result.ready, true, JSON.stringify(result.dependencies));
	const adapter = result.dependencies.find(({ importer, name }) => importer === 'app' && name === '@beyond-js/react-19-widgets');
	assert.deepEqual([adapter.source, adapter.member], ['member', 'vendor/react-19-widgets']);

	const installed = await scenario.request('POST', '/installation', { body: {} });
	assert.equal(installed.body.valid, true, JSON.stringify(installed.body.diagnostics));
	const { body } = await scenario.request('GET', '/dependencies');
	assert.equal(body.nodes.find(({ name }) => name === '@beyond-js/react-19-widgets').key, 'workspace:vendor/react-19-widgets');
	assert.ok(!body.nodes.some(({ source }) => source.kind === 'supplied' && source.member), 'a supplied package is never a member');
});
