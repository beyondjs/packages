/**
 * The preview of a workspace over the real delivery (`fixtures/contract`): every address names the source of
 * its package, and an importer that reaches another version of a specifier gets it in its scope. The selection,
 * the document and a browser are validated by `preview.mjs` and `tests/preview`; this checks the addresses.
 *
 * ```sh
 * BEE_URL=<implementation>[,<utility>…] node --import "$BEE_NODE_DIR/register.mjs" --test tests/development/preview.test.mjs
 * ```
 */
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { Options } from '@beyond-js/artifact-api';
import { Origins } from '@beyond-js/packages/http/routes';
import { Served } from './support/served.mjs';

const served = new Served();
before(() => served.start());
after(() => served.stop());

const CDN = 'https://cdn.example.test';
const development = new Options({ ...Options.development, target: 'browser' }).query;
const published = new Options({ target: 'browser', format: 'esm' }).query;
const registry = await new Origins().registry('https://packages.example.test/npm');

/**
 * A development extension over the facade of the served workspace, with the CDN origin its environment names
 */
const extension = async t => {
	const { Development } = await import('@beyond-js/packages/development');
	process.env.BEYOND_CDN_ORIGIN = CDN;
	t.after(() => delete process.env.BEYOND_CDN_ORIGIN);
	const created = new Development({ delivery: served.facade, settings: { root: served.root } });
	t.after(() => created.stop());
	return created;
};

test('preview: installed packages under their source, and the scope of the importer of another version', async t => {
	const { preview } = await extension(t);
	const described = await preview.describe('@fixture/app/main');

	assert.deepEqual(described.importmap.imports, {
		'@fixture/app/main': `../m/@fixture/app@1.0.0/modules/main?${development}`,
		library: `../m/library@2.0.0/modules/~root?${development}`,
		'@fixture/legacy/main': `../m/@fixture/legacy@1.0.0/modules/main?${development}`,
		'@fixture/legacy/main.css': `../m/@fixture/legacy@1.0.0/styles/main?${development}`
	});
	assert.deepEqual(described.importmap.scopes, {
		'../m/@fixture/legacy@1.0.0/': { library: `../m/${registry}/library@1.2.0/modules/~root?${development}` }
	});
	const versions = described.modules.filter(({ specifier }) => specifier === 'library').map(({ version, source }) => `${version} ${source}`);
	assert.deepEqual(versions, ['1.2.0 environment', '2.0.0 environment'], 'both installations are described');
	assert.deepEqual(described.diagnostics.filter(({ code }) => code !== 'PREVIEW_CDN_UNSET'), []);
});

test('preview: a package of the workspace that is not in development is on the CDN under the registry it is published to', async t => {
	const development_ = await extension(t);
	await development_.selection.replace({ modules: ['@fixture/app/main'] });
	const described = await development_.preview.describe('@fixture/app/main');

	const legacy = `${CDN}/m/${registry}/@fixture/legacy@1.0.0/modules/main?${published}`;
	assert.equal(described.importmap.imports['@fixture/legacy/main'], legacy);
	// What the CDN module imports is scoped to its address on the CDN
	assert.deepEqual(described.importmap.scopes, { [`${CDN}/m/${registry}/@fixture/legacy@1.0.0/`]: { library: `../m/${registry}/library@1.2.0/modules/~root?${development}` } });

	const html = await development_.preview.document('@fixture/app/main');
	assert.ok(html.includes('"scopes"'), 'the document gives the browser the scopes');
});
