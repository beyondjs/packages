import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Served } from './support/served.mjs';

/**
 * A backend target whose package two local versions publish, through the real development service of this checkout:
 * the copy of the launch fixture gets `api-v2/`, `@launches/api` 2.0.0, whose server says a readiness of its own, and
 * the target `v2`, which selects that version. The launch imports the versioned specifier the catalog resolved, so the
 * version it selects is the one that runs and says it is ready; the target that selects none is ambiguous.
 */
const READY = 'fixture API 2.0.0 listening';

/**
 * The second local version of `@launches/api`, and the target that selects it
 */
const prepare = root => {
	cpSync(join(root, 'api'), join(root, 'api-v2'), { recursive: true });
	const manifest = JSON.parse(readFileSync(join(root, 'api-v2', 'package.json'), 'utf8'));
	writeFileSync(join(root, 'api-v2', 'package.json'), JSON.stringify({ ...manifest, version: '2.0.0' }, null, '\t'));
	const server = join(root, 'api-v2', 'server', 'index.ts');
	writeFileSync(server, readFileSync(server, 'utf8').replaceAll('fixture API listening on', `${READY} on`));

	const declaration = JSON.parse(readFileSync(join(root, 'beyond.json'), 'utf8'));
	declaration.packages.push('api-v2');
	const { api } = declaration.applications.fixture.targets;
	declaration.applications.fixture.targets.v2 = { ...api, title: 'Fixture API 2.0.0', selection: '2.0.0', readiness: { output: READY } };
	writeFileSync(join(root, 'beyond.json'), JSON.stringify(declaration, null, '\t'));
};

const served = new Served();
before(async () => {
	try {
		await served.start({ prepare });
	} catch (error) {
		console.error(served.log());
		throw error;
	}
}, { timeout: 900000 });
after(() => served.stop(), { timeout: 120000 });

const code = answer => [answer.status, answer.body?.error?.code];

test('the target that selects one of two local versions launches it by the versioned specifier the catalog resolved', async () => {
	const resolved = await served.send('GET', '/applications/fixture/targets/v2');
	assert.equal(resolved.status, 200, JSON.stringify(resolved.body));
	assert.deepEqual([resolved.body.entry.vspecifier, resolved.body.launch], ['@launches/api@2.0.0/server', { supported: true, specifier: '@launches/api@2.0.0/server' }]);

	const created = await served.send('POST', '/launches', { body: { application: 'fixture', target: 'v2' }, key: 'request-v2-0001' });
	assert.equal(created.status, 202, JSON.stringify(created.body));
	const { id } = created.body.launch;
	assert.equal(created.body.launch.specifier, '@launches/api@2.0.0/server');
	const ready = await served.until(id, launch => launch.state === 'ready' || launch.state === 'failed');
	assert.equal(ready.state, 'ready', `${JSON.stringify(ready)}\n${served.log()}`);
	const lines = (await served.send('GET', `/launches/${id}/output`)).body.lines.map(line => line.text);
	assert.ok(lines.some(line => line.startsWith(`${READY} on http://127.0.0.1:`)), lines.join('\n'));

	await served.send('POST', `/launches/${id}/stop`);
	const exited = await served.until(id, launch => launch.state === 'exited' || launch.state === 'failed', 30000);
	assert.deepEqual([exited.state, exited.exit.code], ['exited', 0]);
});

test('the target that selects no version of the two is ambiguous, and is not launched', async () => {
	const resolved = await served.send('GET', '/applications/fixture/targets/api');
	assert.deepEqual(resolved.body.launch, { supported: false, reason: 'TARGET_AMBIGUOUS' });
	const refused = await served.send('POST', '/launches', { body: { application: 'fixture', target: 'api' }, key: 'request-api-0001' });
	assert.deepEqual([...code(refused), refused.body.error.details.reason], [422, 'TARGET_NOT_LAUNCHABLE', 'TARGET_AMBIGUOUS']);
});
