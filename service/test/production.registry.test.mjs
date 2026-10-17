import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { Credentials } from '../host/production/registry/credentials.mjs';
import { Registry } from '../host/production/registry/registry.mjs';
import { Registry as Stand } from '../../tests/production/support/registry.mjs';

const ARCHIVE = { id: 'arc_000000000000000000000001', integrity: 'sha512-archive', shasum: 'aaaa' };

/**
 * The provider settings npm's configuration would give: the registry of every package, and a token for the hosts the
 * case names
 */
const settings = (registry, tokens = {}) => async () => ({
	get: ({ package: name, hostname, base }) => (hostname ? { base, auth: tokens[hostname] ? { mode: 'token', token: tokens[hostname] } : { mode: 'none' } } : { base: registry, origin: name ? 'project-rc' : 'default', auth: { mode: 'none' } })
});

/**
 * A registry stand-in, stopped when the case ends
 */
const stand = async (t, options) => {
	const registry = await new Stand(options).start();
	t.after(() => registry.stop());
	return registry;
};

const status = (registry, { tokens, environment = {}, archive = ARCHIVE, name = '@scope/ui', version = '1.0.0' } = {}) => {
	const credentials = new Credentials({ root: '/workspace', environment, load: settings(registry.origin, tokens) });
	return new Registry({ credentials, environment }).status({ name, version, registry: registry.origin, archive });
};

test('the status of a version is bound to its content: not published, matching, or another one', async t => {
	const registry = await stand(t);
	assert.equal((await status(registry)).state, 'not-published', 'a name the registry does not have');
	registry.release('@scope/ui', '0.9.0', { integrity: 'sha512-old' });
	const missing = await status(registry);
	assert.equal(missing.state, 'not-published', 'the name without the version');
	assert.match(missing.reason, /without the version 1\.0\.0/);

	registry.release('@scope/ui', '1.0.0', { integrity: ARCHIVE.integrity, shasum: ARCHIVE.shasum });
	const matching = await status(registry);
	assert.equal(matching.state, 'published-matching');
	assert.deepEqual(matching.archive, { id: ARCHIVE.id, integrity: ARCHIVE.integrity });
	assert.equal(matching.published.integrity, ARCHIVE.integrity);
	assert.ok(Date.parse(matching.checked), 'when it was read');

	const other = await status(registry, { archive: { integrity: 'sha512-other', shasum: 'bbbb' } });
	assert.equal(other.state, 'version-exists-different', 'equal name and version do not establish equal bytes');
	const unnamed = await status(registry, { archive: null });
	assert.equal(unnamed.state, 'unverifiable', 'without an archive nothing is compared');

	registry.release('@scope/ui', '2.0.0', {});
	assert.equal((await status(registry, { version: '2.0.0' })).state, 'unverifiable', 'a version without a recorded digest');
	assert.ok(registry.requests.every(({ path }) => path === '/@scope%2Fui'), 'a scoped name is asked as npm asks it');
});

test('a refusal, an outage and an answer that is not a package document are told apart', async t => {
	const closed = await stand(t, { token: 'test-token', private: true });
	const refused = await status(closed);
	assert.deepEqual([refused.state, refused.http], ['refused', 401]);
	closed.release('@scope/ui', '1.0.0', { integrity: ARCHIVE.integrity });
	const host = new URL(closed.origin).host;
	assert.equal((await status(closed, { tokens: { [host]: 'test-token' } })).state, 'published-matching', 'with this machine\'s credential');
	assert.equal(closed.requests.at(-1).authorization, 'present');

	const failing = await stand(t);
	failing.mode = 'fail';
	assert.deepEqual([(await status(failing)).state, (await status(failing)).http], ['unavailable', 500]);
	failing.mode = 'refuse';
	assert.equal((await status(failing)).state, 'refused');
});

test('a registry that does not answer is unavailable within the bound, and one that is not there at once', async t => {
	const silent = await stand(t);
	silent.mode = 'silent';
	const started = Date.now();
	const waited = await status(silent, { environment: { BEYOND_REGISTRY_TIMEOUT: '300' } });
	assert.equal(waited.state, 'unavailable');
	assert.match(waited.reason, /did not answer within 300 ms$/);
	assert.ok(Date.now() - started < 5000, 'the bound ends the wait');

	// A port nothing listens on
	const server = createServer();
	await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
	const { port } = server.address();
	await new Promise(resolve => server.close(resolve));
	const absent = await status({ origin: `http://127.0.0.1:${port}` });
	assert.equal(absent.state, 'unavailable');
	assert.match(absent.reason, /could not be reached/);
});

test('the registry of a package and the credentials of this machine come from npm\'s configuration', async t => {
	const load = async options => ({
		options,
		get: ({ package: name, hostname, base }) =>
			hostname ? { base, auth: hostname === 'registry.example' ? { mode: 'user-pass', user: 'person', token: 'secret' } : { mode: 'none' } } : { base: name.startsWith('@scope/') ? 'https://scope.example/npm' : 'https://registry.npmjs.org', origin: name.startsWith('@scope/') ? 'user-rc' : 'default' }
	});
	const credentials = new Credentials({ root: '/workspace', environment: { npm_config_userconfig: '/home/person/.npmrc-ci' }, load });
	assert.deepEqual(await credentials.registry({ name: '@scope/ui' }), { url: 'https://scope.example/npm', source: 'configuration' });
	assert.deepEqual(await credentials.registry({ name: 'plain' }), { url: 'https://registry.npmjs.org', source: 'default' });
	assert.deepEqual(await credentials.registry({ name: 'plain', publishConfig: { registry: 'https://private.example/npm/' } }), { url: 'https://private.example/npm', source: 'publishConfig' });
	assert.equal(await credentials.authorization('https://registry.example/'), `Basic ${Buffer.from('person:secret').toString('base64')}`);
	assert.equal(await credentials.authorization('https://other.example/'), undefined);

	assert.equal(Credentials.normalized('ftp://registry.example'), undefined);
	assert.equal(Credentials.normalized('https://user:pass@registry.example'), undefined, 'a credential is never part of an address');
	assert.equal(Credentials.normalized('https://registry.example/npm/'), 'https://registry.example/npm');
});
