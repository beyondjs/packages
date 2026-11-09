/**
 * `import.meta` in the sources of a `ts` module (audit F6): the transpilation replaces it with the name the envelope of
 * the internal module declares from the artifact's `import.meta` and the `hot` the runtime gives the creator, so any use
 * builds, for Node and for browsers; the name is reserved; and the types conditional declares `ImportMeta.hot`. The
 * workspace is a copy of `fixtures/workspace`; read the README of the fixtures.
 *
 * ```sh
 * BEE_URL=<implementation> node --import "$BEE_NODE_DIR/register.mjs" --test tests/meta/meta.test.mjs
 * ```
 */
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { cp, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Workspace } from '@beyond-js/packages/workspace';
import { Delivery } from '@beyond-js/packages/artifacts';

const FIXTURES = fileURLToPath(new URL('./fixtures/workspace', import.meta.url));
const ENVELOPE = '__beyond_meta = Object.create(null, { ...Object.getOwnPropertyDescriptors(import.meta), hot: { value: __beyond_meta, enumerable: true } });';

let root, workspace, delivery;
before(async () => {
	root = await realpath(await mkdtemp(join(tmpdir(), 'beyond-meta-')));
	await cp(FIXTURES, root, { recursive: true });
	workspace = new Workspace(root);
	delivery = new Delivery(workspace);
});
after(async () => {
	workspace?.destroy();
	root && (await rm(root, { recursive: true, force: true }));
});

/**
 * Races an answer of the delivery with a bound, so a build that never answers fails the test
 */
const bounded = async (promise, what) => {
	let timer;
	const limit = new Promise((_, reject) => (timer = setTimeout(() => reject(new Error(`${what} never answered`)), 60000)));
	try {
		return await Promise.race([promise, limit]);
	} finally {
		clearTimeout(timer);
	}
};

const request = subpath => ({ name: '@fixture/meta', version: '1.0.0', subpath });
const compiled = (subpath, platform) => bounded(delivery.module(request(subpath), { platform, environment: 'development' }), `${subpath} for ${platform}`);

/**
 * The creators of an artifact by internal module, each the line that opens it and the code up to the next one
 */
const creators = code => Object.fromEntries(code.split(/(?=__ims\.set\(')/).slice(1).map(part => [/^__ims\.set\('([^']+)'/.exec(part)[1], part]));

for (const platform of ['node', 'web']) {
	test(`a source that uses import.meta in any position builds for ${platform}, and only its creator declares it`, async () => {
		const { delivered, failure } = await compiled('./hot', platform);
		assert.equal(failure, undefined, JSON.stringify(failure));
		const { './index': hot, './half': half } = creators(delivered.code('inline'));
		assert.ok(hot && half, Object.keys(creators(delivered.code('inline'))).join(', '));
		assert.match(hot.split('\n')[0], /creator: function \(require, exports, __beyond_meta\) \{ /);
		assert.ok(hot.split('\n')[0].endsWith(ENVELOPE), hot.split('\n')[0]);
		assert.match(hot, /exports\.url = __beyond_meta\.url;/);
		assert.match(hot, /__beyond_meta\.hot\?\.data\.count/);
		// The comment of the source that names it stays, as comments do
		assert.doesNotMatch(hot.split('\n').slice(1).join('\n'), /import\.meta\.(url|hot)/, 'no use of import.meta is left in the code of the source');
		assert.ok(!half.includes(ENVELOPE), 'a source without import.meta declares nothing');
		assert.match(hot, /\{ __beyond_meta: 1 \}\.__beyond_meta/, 'a property of the reserved name is kept as it is');
		assert.match(hot, /const \{ __beyond_meta: renamed \} = \{ __beyond_meta: 2 \}/, 'and so is the key a binding pattern reads');
	});
}

test('the envelope gives the source a copy of every property of the artifact\'s import.meta, with hot', async () => {
	// Evaluated as the envelope evaluates it, over an object standing for the import.meta of an artifact
	const artifact = Object.defineProperties(Object.create(null), {
		url: { value: 'http://127.0.0.1:4100/m/@fixture/meta@1.0.0/modules/hot', enumerable: true },
		resolve: { value: specifier => specifier, enumerable: true },
		hidden: { value: 'kept', enumerable: false }
	});
	const hot = { data: {} };
	const meta = new Function('meta', '__beyond_meta', `${ENVELOPE.replaceAll('import.meta', 'meta')} return __beyond_meta;`)(artifact, hot);
	assert.deepEqual(Object.keys(meta), ['url', 'resolve', 'hot']);
	assert.equal(meta.hidden, 'kept');
	assert.equal(meta.hot, hot);
	assert.equal(Object.getPrototypeOf(meta), null);
});

test('a module whose sources write no import.meta is assembled with no declaration of it', async () => {
	const { delivered, failure } = await compiled('./plain', 'node');
	assert.equal(failure, undefined, JSON.stringify(failure));
	assert.ok(!delivered.code('inline').includes(ENVELOPE));
});

test('a source that writes the reserved name is refused where it writes it', async () => {
	const { delivered, failure } = await compiled('./reserved', 'node');
	assert.equal(delivered, undefined);
	const said = JSON.stringify(failure);
	assert.match(said, /NAME_RESERVED/);
	assert.match(said, /__beyond_meta\\" is a name the artifact reserves for import\.meta: rename it/);
});

test('the declaration type-checks import.meta.hot, and still refuses what ImportMeta does not declare', async () => {
	const hot = await bounded(delivery.declaration(request('./hot')), 'the declaration of ./hot');
	assert.equal(hot.failure, undefined, JSON.stringify(hot.failure));
	assert.ok(!JSON.stringify(hot.declaration).includes('ImportMetaHot'), 'the declaration of ImportMeta.hot is not part of the public declaration');

	const typo = await bounded(delivery.declaration(request('./typo')), 'the declaration of ./typo');
	// TypeScript names the member ImportMeta declares, which is how it is known to be declared
	assert.match(JSON.stringify(typo.failure ?? typo.declaration), /TS2551.*Property 'hott' does not exist on type 'ImportMeta'\. Did you mean 'hot'\?/);
	const { failure } = await compiled('./typo', 'node');
	assert.equal(failure, undefined, 'a type error does not keep the module from building');
});
