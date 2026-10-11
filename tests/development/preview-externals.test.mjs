/**
 * The externals of the development selection over the real delivery of `fixtures/contract`: where a preview loads the
 * installed packages this environment could compile itself. `environment`, the default, keeps every address the
 * preview gave before; `cdn` addresses them on the CDN at their installed exact versions, checks each address with a
 * bounded `HEAD` before giving it, pins the integrity of the digest the CDN answered, gives no address for anything it
 * could not bind (missing, unverified, unanswered) and replaces none, and keeps the packages the toolchain supplies
 * here. The CDN is a stand-in origin (`tests/preview/browser.mjs`) that answers `HEAD` and `GET` for the paths it is
 * given, with an entity tag, and can be made to answer what a CDN of the contract would not; it is not CDN delivery.
 *
 * ```sh
 * BEE_URL=<implementation> node --import "$BEE_NODE_DIR/register.mjs" --test tests/development/preview-externals.test.mjs
 * ```
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { Options } from '@beyond-js/artifact-api';
import { Origins } from '@beyond-js/packages/http/routes';
import { Served } from './support/served.mjs';
import { Origin } from '../preview/browser.mjs';

const served = new Served();
before(() => served.start());
after(() => served.stop());

const development = new Options({ ...Options.development, target: 'browser' }).query;
const published = new Options({ target: 'browser', format: 'esm' }).query;
const registry = await new Origins().registry('https://packages.example.test/npm');
const PACKAGES = ['@fixture/app', '@fixture/composed', '@fixture/legacy'];

// The two installed versions of `library`, as the CDN addresses them: npm unprefixed, the other registry by its id
const LIBRARY = { root: '/m/library@2.0.0/modules/~root', legacy: `/m/${registry}/library@1.2.0/modules/~root` };
const LEGACY = '../m/@fixture/legacy@1.0.0/';

const code = path => `export const version = '${path}';`;
const sri = path => `sha256-${createHash('sha256').update(code(path)).digest('base64')}`;

/**
 * A stand-in CDN that holds the given paths, stopped after the case
 */
const cdn = async (t, ...paths) => {
	const origin = new Origin();
	paths.forEach(path => origin.module(path, code(path)));
	await origin.start();
	t.after(() => origin.stop());
	return origin;
};

/**
 * A development extension over the served workspace, with the environment its service would have
 *
 * @param facade What the host gives the extension, the delivery of the fixture unless a case stands one in
 */
const extension = async (t, environment = {}, facade = served.facade) => {
	const { Development } = await import('@beyond-js/packages/development');
	const previous = Object.fromEntries(Object.keys(environment).map(key => [key, process.env[key]]));
	Object.assign(process.env, environment);
	t.after(() => Object.entries(previous).forEach(([key, value]) => (value === void 0 ? delete process.env[key] : (process.env[key] = value))));
	const created = new Development({ delivery: facade, settings: { root: served.root } });
	t.after(async () => {
		created.stop();
		await created.selection.clear();
	});
	return created;
};

test('externals: environment is the default and gives the addresses the preview always gave', async t => {
	const origin = await cdn(t, LIBRARY.root, LIBRARY.legacy);
	const { selection, preview } = await extension(t, { BEYOND_CDN_ORIGIN: origin.origin });
	assert.equal((await selection.read()).externals, 'environment');

	const described = await preview.describe('@fixture/app/main');
	assert.deepEqual(described.selection, { explicit: false, externals: 'environment' });
	assert.equal(described.importmap.imports.library, `../m/library@2.0.0/modules/~root?${development}`);
	assert.deepEqual(described.importmap.scopes, { [LEGACY]: { library: `../m/${registry}/library@1.2.0/modules/~root?${development}` } });
	assert.deepEqual(origin.checked, [], 'nothing is asked of the CDN');
});

test('externals: cdn addresses the installed packages on the CDN at their installed versions, each checked before it is given', async t => {
	const origin = await cdn(t, LIBRARY.root, LIBRARY.legacy);
	const { selection, preview } = await extension(t, { BEYOND_CDN_ORIGIN: origin.origin });
	assert.equal((await selection.replace({ packages: PACKAGES, externals: 'cdn' })).externals, 'cdn');

	const described = await preview.describe('@fixture/app/main');
	assert.deepEqual(described.selection, { explicit: true, externals: 'cdn' });
	assert.deepEqual(described.diagnostics, []);
	assert.equal(described.importmap.imports.library, `${origin.origin}${LIBRARY.root}?${published}`);
	assert.equal(described.importmap.imports['@fixture/app/main'], `../m/@fixture/app@1.0.0/modules/main?${development}`, 'the workspace stays in development');
	assert.deepEqual(described.importmap.scopes, { [LEGACY]: { library: `${origin.origin}${LIBRARY.legacy}?${published}` } }, 'each importer keeps its own version');

	const versions = described.modules.filter(({ specifier }) => specifier === 'library').map(({ version, source }) => `${version} ${source}`);
	assert.deepEqual(versions, ['1.2.0 cdn', '2.0.0 cdn']);
	assert.deepEqual(origin.checked.map(path => path.split('?')[0]).sort(), [LIBRARY.legacy, LIBRARY.root].sort());
	assert.deepEqual(origin.requests, [], 'checking retrieves nothing');
	assert.deepEqual(described.importmap.integrity, {
		[`${origin.origin}${LIBRARY.root}?${published}`]: sri(LIBRARY.root),
		[`${origin.origin}${LIBRARY.legacy}?${published}`]: sri(LIBRARY.legacy)
	}, 'the import map pins the digest the CDN answered for each address');
	const html = await preview.document('@fixture/app/main');
	assert.ok(html.includes(`"integrity": {`) && html.includes(sri(LIBRARY.root)), 'the document gives the browser the integrity');
});

test('externals: an output the CDN does not hold is unresolved, leaves the import map and nothing takes its place', async t => {
	const origin = await cdn(t, LIBRARY.legacy);
	const { selection, preview } = await extension(t, { BEYOND_CDN_ORIGIN: origin.origin });
	await selection.replace({ packages: PACKAGES, externals: 'cdn' });

	const described = await preview.describe('@fixture/app/main');
	const root = described.modules.find(({ specifier, version }) => specifier === 'library' && version === '2.0.0');
	assert.deepEqual([root.source, root.url, typeof root.reason], ['unresolved', undefined, 'string']);
	assert.deepEqual(described.diagnostics.map(({ code }) => code), ['PREVIEW_CDN_MISSING']);
	assert.ok(described.diagnostics[0].message.includes('HTTP 404'), described.diagnostics[0].message);
	assert.equal(described.importmap.imports.library, void 0, 'no address, not the environment\'s and not another version');
	assert.deepEqual(described.importmap.scopes, { [LEGACY]: { library: `${origin.origin}${LIBRARY.legacy}?${published}` } });

	const html = await preview.document('@fixture/app/main');
	assert.ok(html.includes('PREVIEW_CDN_MISSING'), 'the document logs the reason to the console of the page');
});

test('externals: a scoped version the CDN does not hold fails in its scope instead of falling back to the version of the page', async t => {
	const origin = await cdn(t, LIBRARY.root);
	const { selection, preview } = await extension(t, { BEYOND_CDN_ORIGIN: origin.origin });
	await selection.replace({ packages: PACKAGES, externals: 'cdn' });

	const described = await preview.describe('@fixture/app/main');
	assert.equal(described.importmap.imports.library, `${origin.origin}${LIBRARY.root}?${published}`);
	const scoped = described.importmap.scopes[LEGACY].library;
	assert.ok(scoped.startsWith('data:text/javascript,') && decodeURIComponent(scoped).includes('PREVIEW_CDN_MISSING'), scoped);
	assert.equal(described.modules.find(({ version }) => version === '1.2.0').source, 'unresolved');
});

test('externals: a CDN that does not answer is an outage within the bound, and the address is not given unchecked', async t => {
	const origin = await cdn(t, LIBRARY.root, LIBRARY.legacy);
	origin.silent = true;
	const { selection, preview } = await extension(t, { BEYOND_CDN_ORIGIN: origin.origin, BEYOND_PREVIEW_CDN_TIMEOUT: '400' });
	await selection.replace({ packages: PACKAGES, externals: 'cdn' });

	const started = Date.now();
	const described = await preview.describe('@fixture/app/main');
	const elapsed = Date.now() - started;
	assert.ok(elapsed < 4000, `answered within the bound, in ${elapsed} ms`);
	assert.deepEqual([...new Set(described.diagnostics.map(({ code }) => code))], ['PREVIEW_CDN_UNAVAILABLE']);
	const root = described.modules.find(({ specifier, version }) => specifier === 'library' && version === '2.0.0');
	assert.deepEqual([root.source, root.url], ['unresolved', undefined]);
	assert.ok(root.reason.includes('did not answer within 400 ms'), root.reason);
	assert.equal(described.importmap.imports.library, void 0, 'no address is given unchecked');
	assert.equal(described.importmap.integrity, void 0);
});

for (const [answer, why] of [
	[{ untagged: true }, 'strong sha256 entity tag'],
	[{ type: 'text/html; charset=utf-8' }, 'text/html'],
	[{ redirect: '/elsewhere' }, 'redirect']
]) {
	test(`externals: an answer the address cannot be bound to (${why}) is unverified and nothing takes its place`, async t => {
		const origin = await cdn(t, LIBRARY.legacy);
		origin.module(LIBRARY.root, code(LIBRARY.root), answer);
		const { selection, preview } = await extension(t, { BEYOND_CDN_ORIGIN: origin.origin });
		await selection.replace({ packages: PACKAGES, externals: 'cdn' });

		const described = await preview.describe('@fixture/app/main');
		const root = described.modules.find(({ specifier, version }) => specifier === 'library' && version === '2.0.0');
		assert.deepEqual([root.source, root.url], ['unresolved', undefined]);
		assert.ok(root.reason.includes(why), root.reason);
		assert.deepEqual(described.diagnostics.map(({ code: reported }) => reported), ['PREVIEW_CDN_UNVERIFIED']);
		assert.equal(described.importmap.imports.library, void 0);
		assert.deepEqual(Object.keys(described.importmap.integrity), [`${origin.origin}${LIBRARY.legacy}?${published}`], 'only what was bound is pinned');
	});
}

test('externals: cdn without a CDN origin leaves the externals without an address and says why', async t => {
	const { selection, preview } = await extension(t, { BEYOND_CDN_ORIGIN: '' });
	delete process.env.BEYOND_CDN_ORIGIN;
	await selection.replace({ packages: PACKAGES, externals: 'cdn' });

	const described = await preview.describe('@fixture/app/main');
	assert.ok(described.cdn.reason.includes('BEYOND_CDN_ORIGIN'));
	assert.deepEqual(described.modules.filter(({ specifier }) => specifier === 'library').map(({ source }) => source), ['unresolved', 'unresolved']);
	assert.ok(described.diagnostics.every(({ code }) => code === 'PREVIEW_CDN_UNSET') && described.diagnostics.length, JSON.stringify(described.diagnostics));
	assert.equal(described.importmap.imports.library, void 0);
});

test('externals: a package the toolchain supplies stays on this environment under cdn, with the reason (stand-in facade)', async t => {
	// The fixture has no supplied package: the facade marks @fixture/legacy as one, as the host marks the packages
	// the toolchain supplies
	const facade = { ...served.facade, published: async () => (await served.facade.published()).map(module => (module.name === '@fixture/legacy' ? { ...module, supplied: true } : module)) };
	const origin = await cdn(t, LIBRARY.root, LIBRARY.legacy);
	const { selection, preview } = await extension(t, { BEYOND_CDN_ORIGIN: origin.origin }, facade);
	await selection.replace({ modules: ['@fixture/app/main'], externals: 'cdn' });

	const described = await preview.describe('@fixture/app/main');
	const legacy = described.modules.find(({ specifier }) => specifier === '@fixture/legacy/main');
	assert.deepEqual([legacy.source, legacy.url], ['environment', `../m/@fixture/legacy@1.0.0/modules/main?${development}`]);
	assert.ok(legacy.reason.includes('Supplied by the toolchain'), legacy.reason);
	assert.ok(!origin.checked.some(path => path.includes('@fixture/legacy')), 'a supplied package is never asked of the CDN');
});

test('selection: externals is validated, stored with the working copy and announced', async t => {
	const { selection, files } = await extension(t);
	const events = [];
	files.log.subscribe(event => event.type === 'selection.changed' && events.push(event.selection));

	await assert.rejects(selection.replace({ packages: PACKAGES, externals: 'npm' }), error => error.code === 'SELECTION_INVALID' && error.status === 400);
	assert.deepEqual(await selection.read(), { explicit: false, packages: PACKAGES, modules: [], externals: 'environment', unknown: [] }, 'a refused replacement changes nothing');

	const replaced = await selection.replace({ packages: ['@fixture/app'], externals: 'cdn' });
	assert.deepEqual(replaced, { explicit: true, packages: ['@fixture/app'], modules: [], externals: 'cdn', unknown: [] });
	assert.deepEqual(events, [replaced]);
	assert.deepEqual(JSON.parse(readFileSync(join(served.root, '.beyond/development/selection.json'), 'utf8')), { packages: ['@fixture/app'], modules: [], externals: 'cdn' });

	const again = await extension(t);
	assert.equal((await again.selection.read()).externals, 'cdn', 'a new service over the same working copy reads it');
	assert.equal((await selection.replace({ packages: ['@fixture/app'] })).externals, 'environment', 'a replacement that names none is environment');
});
