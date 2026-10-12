import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Registry } from './support/registry.mjs';
import { Served } from './support/served.mjs';

/**
 * The preflight, archive, registry status and publication of a package, from the real development service started
 * from this checkout over a copy of the packages fixture, with Packages' own readers of publication forms, `exports`
 * and npm's configuration, and the host's npm publishing to a registry of this process. See README.md.
 */
const TOKEN = 'test-token-not-a-real-one';
const parent = realpathSync(mkdtempSync(join(tmpdir(), 'beyond production packages ')));
const served = new Served(parent, { fixture: 'packages' });
const registry = new Registry({ token: TOKEN });

before(async () => {
	await registry.start();
	const userconfig = join(parent, 'npmrc');
	writeFileSync(userconfig, '');
	const npm = { npm_config_userconfig: userconfig, npm_config_cache: join(parent, 'npm-cache'), npm_config_fetch_retries: '0', npm_config_update_notifier: 'false', npm_config_audit: 'false', npm_config_fund: 'false' };
	// The project's own npm configuration names the registry and this machine's credential for it
	const npmrc = `registry=${registry.origin}/\n//${new URL(registry.origin).host}/:_authToken=${TOKEN}\n`;
	await served.start({ environment: npm, files: { '.npmrc': npmrc, 'packages/ui/.env': 'NOT_A_REAL_SECRET=1\n' } });
}, { timeout: 900000 });

after(async () => {
	registry.stop();
	await served.stop().catch(() => void 0);
	rmSync(parent, { recursive: true, force: true });
}, { timeout: 120000 });

const operation = async (path, body, key) => {
	const started = await served.send('POST', path, { headers: key ? { 'idempotency-key': key } : {}, body });
	assert.equal(started.status, 202, JSON.stringify(started.body));
	return served.follow(started.headers.location);
};

test('the preflight reads the package with Packages\' readers and says what prevents its publication', { timeout: 300000 }, async () => {
	const { status, body } = await served.send('GET', '/production/packages/packages%2Fui');
	assert.equal(status, 200, JSON.stringify(body));
	assert.deepEqual([body.name, body.version, body.publication.form, body.registry.url, body.registry.access], ['@production/ui', '1.2.0', 'npm', registry.origin, 'public']);
	assert.deepEqual(body.files.list, ['dist/index.d.ts', 'dist/index.js', 'package.json', 'src/index.ts']);
	assert.deepEqual(body.files.excluded.secrets, ['.env']);
	const extra = body.exports.find(({ subpath }) => subpath === './extra');
	assert.deepEqual([extra.target, extra.included], ['./lib/extra.js', false]);
	const codes = body.findings.map(({ code }) => code);
	for (const code of ['EXPORT_TARGET_EXCLUDED', 'DEPENDENCY_WORKSPACE_PROTOCOL', 'DEPENDENCY_MEMBER', 'SECRETS_EXCLUDED', 'SCRIPTS_NOT_RUN']) assert.ok(codes.includes(code), `${code} in ${codes}`);
	assert.equal(body.ready, false);

	const beyond = (await served.send('GET', '/production/packages/packages%2Fbeyond')).body;
	assert.equal(beyond.publication.form, 'source');
	assert.deepEqual(beyond.exports[0].types, { state: 'generated', provenance: 'generated' }, 'the declaration Beyond generates from its sources');
	const own = (await served.send('GET', '/production/packages/packages%2Fprivate-util')).body;
	assert.ok(own.findings.some(({ code }) => code === 'PACKAGE_PRIVATE'));
	assert.equal((await served.send('GET', '/production/packages/packages%2Fnone')).body.error.code, 'MEMBER_NOT_FOUND');
});

test('a package is packed, read at its registry, published once with the host\'s npm, and found published', { timeout: 600000 }, async () => {
	const packed = await operation('/production/packages/packages%2Fcore/archives', void 0, 'pack-core-00000001');
	assert.equal(packed.state, 'succeeded', JSON.stringify(packed.error));
	const { archive } = packed.result;
	assert.deepEqual(archive.files, ['README.md', 'index.js', 'package.json']);
	assert.equal(readFileSync(join(served.root, '.beyond', 'production', 'archives', `${archive.id}.tgz`)).length, archive.size);

	const before = await operation('/production/packages/packages%2Fcore/status', { archive: archive.id });
	assert.deepEqual([before.result.status.state, before.result.status.registry], ['not-published', registry.origin]);

	const confirm = { name: archive.name, version: archive.version, registry: registry.origin };
	const body = { archive: archive.id, registry: registry.origin, access: 'public', confirm };
	const published = await operation('/production/packages/packages%2Fcore/publish', body, 'publish-core-0000001');
	assert.equal(published.state, 'succeeded', JSON.stringify(published.error));
	assert.deepEqual([published.result.outcome, published.result.verified], ['published', true]);
	assert.deepEqual(registry.published.map(({ name, version, integrity }) => [name, version, integrity]), [['@production/core', '1.0.0', archive.integrity]]);
	assert.ok(!JSON.stringify(published).includes(TOKEN), 'no credential in the operation');

	const again = await operation('/production/packages/packages%2Fcore/publish', body, 'publish-core-0000002');
	assert.equal(again.result.outcome, 'already-published');
	assert.equal(registry.published.length, 1, 'nothing is sent twice');
	const after = await operation('/production/packages/packages%2Fcore/status', { archive: archive.id });
	assert.equal(after.result.status.state, 'published-matching');
});
