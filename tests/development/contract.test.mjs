/**
 * The compiled-module contract as the development service implements it (`@beyond-js/packages/http/routes`):
 * the conformance rules of `@beyond-js/artifact-api` 0.3.0, the resolution documents, `format=system`, the
 * source of an installed package in its path, cross-origin reading and the service-level answers. The
 * workspace is `fixtures/contract`; read its README.
 *
 * ```sh
 * BEE_URL=<implementation>[,<utility>…] node --import "$BEE_NODE_DIR/register.mjs" --test tests/development/contract.test.mjs
 * ```
 */
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { Cors, Options, Resolution } from '@beyond-js/artifact-api';
import { Service } from '@beyond-js/artifact-api/conformance';
import { Origins } from '@beyond-js/packages/http/routes';
import { Served } from './support/served.mjs';

const served = new Served();
before(() => served.start());
after(() => served.stop());

const app = { name: '@fixture/app', version: '1.0.0', subpath: './main' };
const browser = new Options({ ...Options.development, target: 'browser' }).query;
const failed = outcomes => outcomes.filter(outcome => !outcome.ok).map(({ name, detail }) => `${name}: ${detail}`);
const error = async response => [response.status, (await response.json()).error.code];

// The registry the lockfile of the fixture records for the version of `library` that `@fixture/legacy` installs
const registry = await new Origins().registry('https://packages.example.test/npm');

// The development options, inline maps included: the inline-map rule runs on the esbuild packaging mode
const options = { ...Options.development };

test('conformance: the development rules of the contract, the resolution documents and cross-origin reading', async () => {
	const resolution = { target: 'browser', format: 'esm', specifier: '@fixture/app/main' };
	const outcomes = await new Service(served.origin, app, { options, registers: false }, { resolution }).run();
	assert.deepEqual(failed(outcomes), []);
	assert.ok(outcomes.some(({ name }) => name.startsWith('resolution 200')) && outcomes.some(({ name }) => name.startsWith('cors: ')));
	assert.ok(outcomes.some(({ name }) => name.startsWith('inline map: ')), 'the inline-map rule ran');

	// The same rules for System.register modules
	const system = await new Service(served.origin, app, { options: { ...options, format: 'system' }, registers: false }, { resolution: { ...resolution, format: 'system' } }).run();
	assert.deepEqual(failed(system), []);
});

test('resolution: installed packages under the source they came from, and a scope for the importer of another version', async () => {
	assert.match(registry, /^registry-packages-example-test-npm-[0-9a-f]{32}$/);
	const response = await served.get('/resolution.json?target=browser&format=esm');
	assert.equal(response.headers.get('cache-control'), 'no-store');
	const resolution = Resolution.parse(await response.text());

	assert.deepEqual(Object.fromEntries(resolution.imports), {
		'@fixture/app/main': `/m/@fixture/app@1.0.0/modules/main?${browser}`,
		'@fixture/app/theme.css': `/m/@fixture/app@1.0.0/styles/theme?${browser}`,
		'@fixture/composed/main': `/m/@fixture/composed@1.0.0/modules/main?${browser}`,
		'@fixture/legacy/main': `/m/@fixture/legacy@1.0.0/modules/main?${browser}`,
		'@fixture/legacy/main.css': `/m/@fixture/legacy@1.0.0/styles/main?${browser}`,
		library: `/m/library@2.0.0/modules/~root?${browser}`
	});
	assert.equal(resolution.resolve('@fixture/app/theme'), undefined, 'a style module has no JavaScript to resolve');
	assert.deepEqual(Object.fromEntries([...resolution.scopes].map(([scope, table]) => [scope, Object.fromEntries(table)])), {
		'/m/@fixture/legacy@1.0.0/': { library: `/m/${registry}/library@1.2.0/modules/~root?${browser}` }
	});

	// Every address the document gives is delivered by the service, but the stylesheet of the style module: see the README
	const addresses = [...resolution.imports, ...resolution.scopes.get('/m/@fixture/legacy@1.0.0/')].filter(([specifier]) => specifier !== '@fixture/app/theme.css');
	for (const [specifier, url] of addresses) {
		const delivered = await served.get(url);
		assert.equal(delivered.status, 200, `${specifier}: ${url}`);
	}
	assert.match(await (await served.get(resolution.resolve('library', '/m/@fixture/legacy@1.0.0/modules/main'))).text(), /1\.2\.0 from packages\.example\.test/);

	// A Node consumer resolves installed packages from its installation: the node document lists what this service builds for Node
	const node = Resolution.parse(await (await served.get('/resolution.json?target=node&format=esm')).text());
	assert.deepEqual([...node.imports.keys()], ['@fixture/app/main', '@fixture/composed/main', '@fixture/legacy/main']);
	const fallback = Resolution.parse(await (await served.get('/resolution.json')).text());
	assert.deepEqual([fallback.target, fallback.format], ['node', 'esm'], 'without a query, the options of the session');
});

test('importmap.json: the same resolution with addresses relative to the document', async () => {
	const response = await served.get('/importmap.json?target=browser&format=system');
	assert.match(response.headers.get('content-type'), /^application\/importmap\+json/);
	const map = await response.json();
	const resolution = Resolution.parse(await (await served.get('/resolution.json?target=browser&format=system')).text());
	assert.deepEqual(map, resolution.importmap());

	// Resolved against the URL of the document, an address is a module of this service
	const url = new URL(map.scopes['./m/@fixture/legacy@1.0.0/'].library, `${served.origin}/importmap.json`);
	const delivered = await served.get(`${url.pathname}${url.search}`);
	assert.equal(delivered.status, 200);
	assert.match(await delivered.text(), /System\.register\(/);
});

test('format=system: the ES module of the delivery as a System.register module with its map inline', async () => {
	const esm = await (await served.get(`/m/@fixture/legacy@1.0.0/modules/main?${browser}`)).text();
	const response = await served.get(`/m/@fixture/legacy@1.0.0/modules/main?${browser.replace('format=esm', 'format=system')}`);
	const code = await response.text();
	assert.equal(response.status, 200);
	assert.match(code, /^System\.register\(\["library"\]/m, 'the bare reference is a named dependency');
	assert.match(code, /exports_1\("legacy"/, 'the export is a live binding');
	assert.ok(!/^import /m.test(code) && /^import /m.test(esm));

	const map = text => JSON.parse(Buffer.from(/\/\/# sourceMappingURL=data:application\/json;(?:charset=utf-8;)?base64,([A-Za-z0-9+/=]+)\s*$/.exec(text)[1], 'base64').toString('utf8'));
	assert.deepEqual(map(code).sources, map(esm).sources, 'the map of the conversion still names the original sources');
	assert.ok(map(code).mappings.length, 'and maps the converted code to them');

	const cjs = await served.get(`/m/@fixture/legacy@1.0.0/modules/main?${browser.replace('format=esm', 'format=cjs')}`);
	assert.deepEqual(await error(cjs), [400, 'OPTION_UNSUPPORTED']);
	assert.deepEqual(await error(await served.get('/resolution.json?target=browser&format=cjs')), [400, 'OPTION_UNSUPPORTED']);
});

test('sources: an installed package is addressed by the registry its lockfile recorded, and only by it', async () => {
	const at = path => served.get(`${path}?${browser}`);
	assert.equal((await at(`/m/${registry}/library@1.2.0/modules/~root`)).status, 200);
	assert.equal((await at('/m/library@2.0.0/modules/~root')).status, 200);

	const expectations = [
		['/m/library@1.2.0/modules/~root', 404, 'PACKAGE_NOT_FOUND', 'the npm path does not deliver what another registry published'],
		[`/m/${registry}/library@2.0.0/modules/~root`, 404, 'PACKAGE_NOT_FOUND', 'nor the other way round'],
		[`/m/${registry}/library@9.9.9/modules/~root`, 404, 'VERSION_MISMATCH', 'another version of a package installed from that registry'],
		['/m/other-registry/library@1.2.0/modules/~root', 404, 'PACKAGE_NOT_FOUND', 'a registry nothing was installed from'],
		[`/m/${registry}/@fixture/app@1.0.0/modules/main`, 404, 'PACKAGE_NOT_FOUND', 'a package of the workspace belongs to no registry'],
		['/m/tool@1.0.0/modules/~root', 501, 'SOURCE_UNSUPPORTED', 'a package installed from Git has no registry address'],
		[`/m/git/github.com/example/tool@${'0'.repeat(40)}/modules/main`, 501, 'SOURCE_UNSUPPORTED', 'a git source'],
		[`/m/digest/sha256-${'0'.repeat(64)}/modules/main`, 501, 'SOURCE_UNSUPPORTED', 'a digest source']
	];
	for (const [path, status, code, why] of expectations) assert.deepEqual(await error(await at(path)), [status, code], `${path}: ${why}`);
});

// A request that never settles fails the test instead of hanging it
const bounded = (path, ms = 60000) => fetch(`${served.origin}${path}`, { signal: AbortSignal.timeout(ms) });

test('outputs: a style module of the esbuild packaging mode has a stylesheet and no JavaScript', async () => {
	const sheet = await bounded(`/m/@fixture/app@1.0.0/styles/theme?${browser}`);
	assert.equal(sheet.status, 200);
	assert.match(sheet.headers.get('content-type'), /^text\/css/);
	assert.match(await sheet.text(), /--fixture-accent:\s*rebeccapurple/);

	const code = await bounded(`/m/@fixture/app@1.0.0/modules/theme?${browser}`);
	const body = await code.json();
	assert.deepEqual([code.status, body.error.code], [404, 'OUTPUT_NOT_AVAILABLE']);
	assert.match(body.error.message, /\/styles\/theme/, 'the answer names the stylesheet');

	// The delivery answers the code of the module as an output it does not have, with the hash of its sheet,
	// which is how a build reports the module as valid
	const theme = { name: '@fixture/app', version: '1.0.0', subpath: './theme' };
	const { delivered, failure } = await served.facade.module(theme, { platform: 'web', environment: 'development' });
	assert.equal(delivered, undefined);
	assert.equal(failure.code, 'OUTPUT_NOT_AVAILABLE');
	assert.match(failure.styles, /^[0-9a-f]{32}$/);
});

test('errors: every answer, errors included, can be read by another origin, and a path the service does not serve is NOT_FOUND', async () => {
	for (const path of [`/m/@fixture/app@1.0.0/modules/absent?${browser}`, '/resolution.json?target=browser', '/nothing/here']) {
		const response = await served.get(path);
		assert.equal(Cors.violation(response.headers), undefined, path);
		assert.equal(response.headers.get('cache-control'), 'no-store', path);
	}
	assert.deepEqual(await error(await served.get('/nothing/here')), [404, 'NOT_FOUND']);
	assert.deepEqual(await error(await served.get('/resolution.json?target=browser&format=esm&env=production')), [400, 'OPTION_INVALID']);
});

test('updates: the update of a composed module in the format its consumer loads, System.register included', async () => {
	const composed = { name: '@fixture/composed', version: '1.0.0', subpath: './main' };
	const { delivered, failure } = await served.facade.module(composed, { platform: 'web', environment: 'development' });
	assert.equal(failure, undefined, JSON.stringify(failure));

	const path = `/u/${delivered.hash}/@fixture/composed@1.0.0/modules/main`;
	const esm = await served.get(`${path}?${browser}`);
	const system = await served.get(`${path}?${browser.replace('format=esm', 'format=system')}`);
	assert.deepEqual([esm.status, system.status], [200, 200]);
	const [code, converted] = await Promise.all([esm.text(), system.text()]);
	assert.ok(code.length && !/System\.register\(/.test(code));
	assert.match(converted, /^System\.register\(/m);

	// A superseded hash is still refused, whatever the format
	const stale = await served.get(`/u/${'0'.repeat(32)}/@fixture/composed@1.0.0/modules/main?${browser.replace('format=esm', 'format=system')}`);
	assert.deepEqual(await error(stale), [409, 'UPDATE_SUPERSEDED']);
});
