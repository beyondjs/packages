/**
 * The application of a plan beside other hosts on the same root (`service/host/dependencies/apply.mjs`): the plan names
 * the host that runs it (`Owner`), a host that starts beside a live one neither interrupts nor reconciles it, and an
 * application the service stopped is reconciled once, never over a later application of its plan. Over the stand-ins
 * of `tests/dependencies/support/stage.mjs`, as `dependencies.plans.test.mjs`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Stage } from '../../tests/dependencies/support/stage.mjs';
import { Operations } from '../host/operations/operations.mjs';
import { Owner } from '../host/operations/owner.mjs';
import { Services } from '../host/features.mjs';
import { Modules } from '../host/dependencies/modules.mjs';
import { Feature } from '../host/dependencies/index.mjs';

const LOCK = JSON.parse(readFileSync(new URL('../../tests/dependencies/fixtures/locks/workspace.json', import.meta.url), 'utf8'));
const graph = () => structuredClone({ members: LOCK.members, nodes: LOCK.nodes, edges: LOCK.edges, overrides: [], exceptions: [] });
const resolution = document => ({ valid: true, graph: document, lock: 'sha256-proposed', diagnostics: [], requests: 3, duration: 12, releases: [] });
const report = { protocol: 'beyond-installation/1', valid: true, frozen: false, lock: { path: 'beyond-lock.json', digest: 'sha256-proposed', written: true }, execution: { path: '.beyond/execution.json', written: true }, counts: { members: 3, nodes: 11, fetched: 1, reused: 7 }, diagnostics: [] };
const Execution = { read: async () => ({ state: 'ready', diagnostics: [], execution: { node: () => ({}) } }) };
const CHANGE = [{ name: 'react', importer: 'apps/admin', range: '^18.3.1 || ^19.0.0' }];

const planned = async stage => {
	const { base } = (await stage.send('GET', '/dependencies')).body;
	const operation = await stage.run('/dependencies/plans', { changes: CHANGE, base });
	assert.equal(operation.state, 'succeeded', JSON.stringify(operation));
	return operation.result;
};

/**
 * Starts the dependency management of another host on the stage's root, as its service would, with its owner
 */
const beside = async (stage, owner) => {
	const operations = new Operations({ root: stage.root, ...(owner ? { owner } : {}) });
	await operations.start();
	const context = { root: stage.root, settings: {}, workspace: {}, operations, services: new Services(), log: () => void 0 };
	await new Feature(context, new Modules({ Installation: stage.installation.class, Execution })).start();
	return operations;
};

const application = async (stage, plan) => (await stage.send('GET', `/dependencies/plans/${plan.id}`)).body.plan.application;

test('an application another live host runs is neither interrupted nor reconciled by a host that starts beside it', async t => {
	let open;
	const held = new Promise(resolve => (open = resolve));
	t.after(() => open());
	// The File API stand-in waits between the read of the manifest and its write: the application runs until released
	const stage = await Stage.start(t, { lock: true, state: 'ready', before: () => held });
	stage.installation.resolutions = [resolution(graph())];
	stage.installation.report = report;
	const plan = await planned(stage);

	const started = await stage.send('POST', `/dependencies/plans/${plan.id}/apply`, { body: { base: plan.base }, headers: { 'idempotency-key': 'apply-hosts-0001' } });
	assert.equal(started.status, 202, JSON.stringify(started.body));
	const { id } = started.body.operation;
	await stage.ended(id, record => record.steps[1].state === 'progress');
	const running = await application(stage, plan);
	assert.deepEqual([running.operation, running.state, running.owner], [id, 'running', stage.operations.owner.toJSON()]);

	// Another host: a process of its own (the test runner stands for it), which finds this one alive
	const other = await beside(stage, new Owner({ pid: process.ppid, token: 'beside' }));
	assert.equal((await other.get(id)).state, 'running');
	assert.deepEqual(await application(stage, plan), running, 'its record on the plan is left as it was');

	open();
	const ended = await stage.ended(id);
	assert.equal(ended.state, 'succeeded', JSON.stringify(ended));
	assert.equal((await application(stage, plan)).state, 'applied');
	await other.idle();
});

test('an application the service stopped is reconciled once, and never over a later application of its plan', async t => {
	const stage = await Stage.start(t, { lock: true, state: 'ready' });
	stage.installation.resolutions = [resolution(graph())];
	stage.installation.report = report;
	const plan = await planned(stage);

	// What a host that died while applying the plan left: its running operation and the record on the plan
	const child = spawn(process.execPath, ['-e', ''], { stdio: 'ignore' });
	await new Promise(resolve => child.once('exit', resolve));
	const gone = { pid: child.pid, token: 'gone-host' };
	const stopped = 'op_00000000000000000000aa01';
	const created = new Date().toISOString();
	const steps = [{ id: 'verify', state: 'progress', since: created }];
	const record = { protocol: 'beyond-dev-operations/1', id: stopped, kind: 'dependencies.apply', key: 'apply-gone-0001', scope: { kind: 'workspace', plan: plan.id }, state: 'running', created, cancellable: false, steps, owner: gone };
	writeFileSync(join(stage.root, '.beyond', 'operations', `${stopped}.json`), JSON.stringify(record));
	const file = join(stage.root, '.beyond', 'dependencies', 'plans', `${plan.id}.json`);
	writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, 'utf8')), application: { operation: stopped, state: 'running', at: created, owner: gone } }));

	// The other hosts of this case run in this process, so they take the stage's records for an earlier process's: they
	// start once those records say how the stage's work ended
	await stage.operations.idle();
	const first = await beside(stage);
	assert.equal((await first.get(stopped)).state, 'interrupted');
	const reconciled = await application(stage, plan);
	assert.deepEqual([reconciled.operation, reconciled.state, reconciled.outcome, reconciled.reconciled], [stopped, 'interrupted', 'not-applied', stopped]);

	// A later application of the plan: the next start finds the stopped one again, and leaves the plan's record alone
	const later = await stage.run(`/dependencies/plans/${plan.id}/apply`, { base: plan.base }, { 'idempotency-key': 'apply-later-0001' });
	assert.equal(later.state, 'succeeded', JSON.stringify(later));
	const applied = await application(stage, plan);
	assert.deepEqual([applied.operation, applied.state], [later.id, 'applied']);

	await stage.operations.idle();
	await beside(stage);
	assert.deepEqual(await application(stage, plan), applied);
	await first.idle();
});
