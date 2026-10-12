import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Members } from '../host/production/members.mjs';
import { Archives } from '../host/production/packing/archives.mjs';
import { Credentials } from '../host/production/registry/credentials.mjs';
import { Publisher } from '../host/production/registry/publisher.mjs';
import { Publishing } from '../host/production/registry/publishing.mjs';
import { Registry } from '../host/production/registry/registry.mjs';
import { Operations } from '../host/operations/operations.mjs';
import { Registry as Stand } from '../../tests/production/support/registry.mjs';
import { copy, until } from '../../tests/production/support/workspaces.mjs';

const TOKEN = 'test-token-not-a-real-one';

/**
 * The environment npm runs with in these cases: the person's npm configuration left out (a user configuration of the
 * case's own, holding the stand-in registry's token, and a cache of its own), no retries, no notices
 */
const environment = (parent, registry) => {
	const clean = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^npm_config_/i.test(name) && !/^NPM_/.test(name)));
	const userconfig = join(parent, 'npmrc');
	writeFileSync(userconfig, `//${new URL(registry.origin).host}/:_authToken=${TOKEN}\n`);
	return { ...clean, npm_config_userconfig: userconfig, npm_config_cache: join(parent, 'npm-cache'), npm_config_fetch_retries: '0', npm_config_update_notifier: 'false', npm_config_fund: 'false', npm_config_audit: 'false' };
};

/**
 * A workspace with a packed archive of `@production/core`, a registry stand-in, and the publication's collaborators
 */
const setup = async (t, { publisher } = {}) => {
	const { root, parent, settle } = copy(t, 'packages');
	const registry = await new Stand({ token: TOKEN }).start();
	t.after(() => registry.stop());
	const env = environment(parent, registry);
	const member = new Members(root).resolve('packages/core');
	const archives = new Archives(root);
	const archive = await archives.create(member);
	const credentials = new Credentials({ root, environment: env, load: async () => ({ get: ({ hostname, base }) => ({ base: base ?? registry.origin, origin: 'user-rc', auth: hostname ? { mode: 'token', token: TOKEN } : { mode: 'none' } }) }) });
	const status = new Registry({ credentials, environment: env });
	const npm = publisher?.(registry) ?? new Publisher({ cwd: root, environment: env });
	const publishing = new Publishing({ registry: status, publisher: npm, archives });
	const operations = new Operations({ root });
	await operations.start();
	settle(() => operations.idle());
	const publish = async key => {
		const { operation } = await operations.run({ kind: 'production.publish', key, steps: Publishing.STEPS }, op => publishing.run(op, { archive, registry: registry.origin, access: 'public', tag: 'latest', directory: member.directory }));
		await until(async () => (await operations.get(operation.id)).state !== 'running', 120000);
		return operations.get(operation.id);
	};
	return { root, registry, archive, archives, publish };
};

test('a publication sends the archive once with npm, and the registry then holds its content', async t => {
	const { registry, archive, publish } = await setup(t);
	const first = await publish('publish-first-0001');
	assert.equal(first.state, 'succeeded', JSON.stringify(first.error));
	assert.equal(first.result.outcome, 'published');
	assert.equal(first.result.verified, true);
	assert.equal(first.result.status.state, 'published-matching');
	assert.deepEqual(registry.published.map(({ name, version, integrity, tag, access }) => [name, version, integrity, tag, access]), [['@production/core', '1.0.0', archive.integrity, 'latest', 'public']]);
	assert.deepEqual(first.steps.map(({ state }) => state), ['done', 'done', 'done']);
	assert.ok(!JSON.stringify(first).includes(TOKEN), 'no credential in the operation');

	// The same content again: the registry is read and nothing is sent
	const again = await publish('publish-again-0002');
	assert.equal(again.result.outcome, 'already-published');
	assert.deepEqual(again.steps.map(({ state }) => state), ['done', 'skipped', 'skipped']);
	assert.equal(registry.published.length, 1);
});

test('a version the registry holds with other content is never overwritten, and a refusal sends nothing', async t => {
	const { registry, publish } = await setup(t);
	registry.release('@production/core', '1.0.0', { integrity: 'sha512-someone-else' });
	const exists = await publish('publish-exists-0001');
	assert.deepEqual([exists.state, exists.error.code], ['failed', 'VERSION_EXISTS']);
	assert.equal(exists.error.details.status.state, 'version-exists-different');

	registry.mode = 'refuse';
	const refused = await publish('publish-refused-0002');
	assert.deepEqual([refused.state, refused.error.code], ['failed', 'REGISTRY_REFUSED']);
	registry.mode = 'fail';
	const unavailable = await publish('publish-unavailable-0003');
	assert.equal(unavailable.error.code, 'REGISTRY_UNAVAILABLE');
	assert.deepEqual(registry.published, [], 'nothing was ever sent');
	assert.ok(registry.requests.every(({ method }) => method === 'GET'));
});

test('a publication whose answer was lost is reconciled with what the registry holds, never sent again', async t => {
	const { registry, archive, publish } = await setup(t);
	registry.mode = 'drop';
	const dropped = await publish('publish-dropped-0001');
	assert.equal(dropped.state, 'succeeded', JSON.stringify(dropped.error));
	assert.deepEqual([dropped.result.outcome, dropped.result.reconciled, dropped.result.verified], ['published', true, true]);
	assert.notEqual(dropped.result.npm.exit, 0, 'npm itself did not see an answer');
	assert.equal(dropped.result.status.published.integrity, archive.integrity);
	assert.equal(registry.published.length, 1, 'the archive was sent once');
});

test('npm that does not answer and a registry that cannot be read afterwards is an unknown outcome, read before any retry', async t => {
	let calls = 0;
	const packed = {};
	// npm that writes the version and then never answers, while the registry stops answering reads
	const publisher = registry => ({
		run: async () => {
			calls++;
			registry.release('@production/core', '1.0.0', { integrity: packed.integrity });
			registry.mode = 'fail';
			return { exit: null, signal: 'SIGKILL', expired: true, output: ['npm did not answer'] };
		}
	});
	const { registry, archive, publish } = await setup(t, { publisher });
	packed.integrity = archive.integrity;
	const unknown = await publish('publish-unknown-0001');
	assert.deepEqual([unknown.state, unknown.error.code, unknown.error.details.outcome], ['failed', 'PUBLISH_UNKNOWN', 'unknown']);
	assert.equal(unknown.steps[1].state, 'failed');

	// The registry answers again: the next publication reads it and finds the version, so nothing is sent twice
	registry.mode = 'normal';
	const next = await publish('publish-next-0002');
	assert.equal(next.result.outcome, 'already-published');
	assert.equal(calls, 1, 'npm ran once');
});

test('npm is bounded by BEYOND_PUBLISH_TIMEOUT and its group ended; what it writes is kept without credentials', async t => {
	const { parent } = copy(t, 'packages');
	const hanging = new Publisher({ cwd: parent, command: process.execPath, args: ['-e', 'setInterval(() => {}, 1000)'], environment: { ...process.env, BEYOND_PUBLISH_TIMEOUT: '300' } });
	const started = Date.now();
	const ended = await hanging.run({ file: join(parent, 'none.tgz'), registry: 'http://127.0.0.1:9', access: 'public', tag: 'latest' });
	assert.equal(ended.expired, true);
	assert.ok(Date.now() - started < 10000, 'the bound ended the wait');

	const script = 'console.error("npm error code E401"); console.error("//registry.example/:_authToken=abc123secret"); console.error("Authorization: Bearer abc.def.ghi"); console.error("npm_abcdefghijklmnopqrstuvwxyz0123456789"); process.exit(1);';
	const failing = new Publisher({ cwd: parent, command: process.execPath, args: ['-e', script] });
	const failed = await failing.run({ file: join(parent, 'none.tgz'), registry: 'http://127.0.0.1:9', access: 'public', tag: 'latest' });
	assert.deepEqual([failed.exit, failed.code, failed.expired], [1, 'E401', false]);
	const text = failed.output.join('\n');
	assert.ok(!/abc123secret|abc\.def\.ghi|npm_abcdefghij/.test(text), text);
	assert.match(text, /_authToken=\[redacted\]/);
});
