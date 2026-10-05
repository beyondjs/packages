import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { InstallationRoutes } from '../host/routes.mjs';
import { Stand } from './support/installation.mjs';
import { mount } from './support/routes.mjs';

const mounted = (t, stand) => mount(t, stand);

/**
 * Waits for a condition, failing instead of hanging when it does not arrive
 */
const until = async (condition, what, limit = 5000) => {
	const deadline = Date.now() + limit;
	while (!condition()) {
		if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
		await new Promise(resolve => setTimeout(resolve, 5));
	}
};

test('the installation is described as it is on disk: state, declaration, lock and projection', async t => {
	const stand = new Stand({ projection: 'ready' });
	const { root, get } = await mounted(t, stand);
	writeFileSync(join(root, 'beyond-lock.json'), JSON.stringify({ protocol: 'beyond-lock/2', digest: 'sha256-lock' }));

	assert.deepEqual(await get(), {
		state: 'ready',
		diagnostics: [],
		running: false,
		queued: 0,
		declaration: {
			kind: 'npm',
			valid: true,
			members: [{ id: 'app', name: '@fixture/app', version: '1.0.0' }, { id: '../widget', name: '@fixture/widget', version: '2.0.0' }],
			diagnostics: []
		},
		lock: { path: join(root, 'beyond-lock.json'), digest: 'sha256-lock' },
		execution: { path: join(root, '.beyond/execution.json'), nodes: 3, written: '2026-10-05T10:00:00.000Z' }
	});
	assert.deepEqual(
		stand.reads,
		[{ inputs: stand.declaration.inputs, locations: { app: '/ws/app', '../widget': '/widget' } }],
		'the projection is read for the current inputs and the directory of each member (A20)'
	);
});

test('a workspace that was never installed has no lock digest, no nodes and no time of writing', async t => {
	const stand = new Stand({ projection: 'missing' });
	const { root, get } = await mounted(t, stand);
	writeFileSync(join(root, 'beyond-lock.json'), JSON.stringify({ react: { version: '19.1.1' } }));

	const described = await get();
	assert.equal(described.state, 'missing');
	assert.equal(described.diagnostics[0].code, 'EXECUTION_GRAPH_MISSING');
	assert.equal(described.lock.digest, null, 'a lock of the old format records no digest');
	assert.deepEqual(described.execution, { path: join(root, '.beyond/execution.json'), nodes: 0, written: null });
});

test('an installation is run with the declaration read again, and the workspace is reloaded once it is written', async t => {
	const stand = new Stand({ projection: 'missing' });
	const { root, post } = await mounted(t, stand);

	const { status, body } = await post(JSON.stringify({ update: true }));
	assert.equal(status, 200);
	assert.deepEqual(body, stand.report);
	assert.equal(stand.installations.length, 1);

	const [{ params, options }] = stand.installations;
	assert.deepEqual(options, { update: true });
	assert.equal(params.root, root);
	assert.deepEqual(params.inputs, stand.declaration.inputs);
	assert.deepEqual(params.manifest, stand.declaration.manifest, 'the root manifest of a workspace');
	assert.deepEqual(params.members, stand.declaration.members.map(({ id, name, version, path, manifest }) => ({ id, name, version, path, manifest })));
	assert.equal(stand.reloads, 1);
});

test('a standalone package is installed without a root manifest: it is its own member', async t => {
	const stand = new Stand({ projection: 'missing', kind: 'standalone' });
	const { post } = await mounted(t, stand);

	assert.equal((await post('')).status, 200, 'an empty body is no options');
	assert.equal('manifest' in stand.installations[0].params, false);
	assert.deepEqual(stand.installations[0].options, {});
});

test('an installation that wrote nothing does not reload the workspace, and is answered as it ended', async t => {
	const stand = new Stand({ projection: 'missing', written: false, valid: false });
	const { post } = await mounted(t, stand);

	const { status, body } = await post('{"offline":true}');
	assert.equal(status, 200, 'an installation that is not valid is an outcome');
	assert.equal(body.valid, false);
	assert.equal(stand.reloads, 0);
});

test('a reload that does not settle after the installation is reported in the report, not as a failure', async t => {
	const stand = new Stand({ projection: 'missing', reload: 'unavailable' });
	const { post } = await mounted(t, stand);

	const { status, body } = await post('{}');
	assert.equal(status, 200);
	assert.equal(body.valid, true);
	const [warning] = body.diagnostics;
	assert.equal(warning.code, 'UNAVAILABLE');
	assert.equal(warning.severity, 'warning');
	assert.match(warning.message, /installation was written.*next request/s);
});

test('a declaration with errors is refused with its diagnostics, and nothing is installed', async t => {
	const stand = new Stand({ projection: 'missing', valid: false, declaration: 'conflict' });
	const { post } = await mounted(t, stand);

	const { status, body } = await post('{}');
	assert.equal(status, 422);
	assert.equal(body.error.code, 'DECLARATION_INVALID');
	assert.match(body.error.message, /declared in beyond.json and in package.json/);
	assert.deepEqual(body.error.diagnostics, stand.declaration.diagnostics);
	assert.equal(stand.installations.length, 0);
});

test('options that are not booleans, unknown options and bodies that are not JSON objects are refused', async t => {
	const stand = new Stand({ projection: 'missing' });
	const { post } = await mounted(t, stand);

	for (const body of ['{"update":"yes"}', '{"force":true}', 'update', '[true]', `{"update":true,"pad":"${'x'.repeat(InstallationRoutes.LIMIT)}"}`]) {
		const answer = await post(body);
		assert.equal(answer.status, 400, body.slice(0, 40));
		assert.equal(answer.body.error.code, 'OPTION_INVALID');
	}
	assert.equal(stand.installations.length, 0);
});

test('installations run one at a time, each reading the declaration when its turn comes', async t => {
	const stand = new Stand({ projection: 'missing', held: true });
	const { post, installer } = await mounted(t, stand);

	// Count the requests that reached the installer, whatever it does with them
	let asked = 0;
	const install = installer.install.bind(installer);
	installer.install = options => (asked++, install(options));

	const first = post('{}');
	await stand.started(1);
	const second = post('{"update":true}');
	await until(() => asked === 2, 'the second request to reach the installer');

	// The second waits for the first: it read no declaration and started nothing, and the declaration becomes
	// invalid before its turn
	assert.equal(stand.declarations, 1);
	assert.equal(stand.installations.length, 1);
	stand.invalidate();
	stand.release();

	assert.equal((await first).status, 200);
	const refused = await second;
	assert.equal(refused.status, 422, 'the declaration was read when the turn of the second came');
	assert.equal(stand.installations.length, 1);
});

test('an installation that fails unexpectedly is a service error, and the next one still runs', async t => {
	const stand = new Stand({ projection: 'missing', failing: 1 });
	const { post } = await mounted(t, stand);

	const failed = await post('{}');
	assert.equal(failed.status, 500);
	assert.match(failed.body.error.message, /the stand-in failed/);

	assert.equal((await post('{}')).status, 200);
	assert.equal(stand.installations.length, 2);
});

test('the class that installs is loaded to install, never to describe', async t => {
	const stand = new Stand({ projection: 'missing' });
	const { get, post } = await mounted(t, stand);

	await get();
	assert.equal(stand.loads, 0, 'describing does not load it');
	await post('{}');
	assert.equal(stand.loads, 1);
});
