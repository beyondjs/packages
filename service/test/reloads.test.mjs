import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Reloads } from '../host/reloads.mjs';

/**
 * The host announces `workspace.changed` once a reload served the declarations a File API event changed: stand-ins of
 * the event log of the development extension, of the hosted workspace (its `refresh()` and its count of reloads) and
 * of the events of the host.
 */
class Log {
	#listeners = new Set();

	subscribe(listener) {
		this.#listeners.add(listener);
		return () => this.#listeners.delete(listener);
	}

	get size() {
		return this.#listeners.size;
	}

	append(type, data = {}) {
		this.#listeners.forEach(listener => listener({ type, ...data }));
	}
}

/**
 * A hosted workspace whose refresh reloads when a declaration changed since the last one, as `Hosted` does; `stalled`
 * makes the next refresh never settle and `failing` makes it reject
 */
class Workspace {
	reloads = 0;
	refreshes = 0;
	changed = false;
	stalled = false;
	failing = false;

	async refresh() {
		this.refreshes++;
		if (this.stalled) return new Promise(() => void 0);
		await new Promise(resolve => setTimeout(resolve, 5));
		if (this.failing) throw Object.assign(new Error('the reload failed'), { code: 'UNAVAILABLE' });
		if (this.changed) {
			this.changed = false;
			this.reloads++;
		}
	}
}

const setup = (bound = 1000) => {
	const log = new Log();
	const workspace = new Workspace();
	const announced = [];
	const messages = [];
	const events = { emit: (type, data) => announced.push({ type, ...data }) };
	const reloads = new Reloads({ workspace, events, log: message => messages.push(message), bound }).start(log);
	return { log, workspace, announced, messages, reloads };
};

/**
 * Waits until a condition holds, within a bound, so a case that never gets there fails instead of hanging
 */
const until = async (condition, ms = 2000) => {
	const deadline = Date.now() + ms;
	while (!condition()) {
		if (Date.now() > deadline) throw new Error('The condition did not hold in time');
		await new Promise(resolve => setTimeout(resolve, 5));
	}
};

test('a changed manifest reloads the workspace and is announced once with the count of reloads', async () => {
	const { log, workspace, announced } = setup();
	workspace.changed = true;
	log.append('file.changed', { path: 'web/package.json', origin: 'external' });
	await until(() => announced.length === 1);
	assert.deepEqual(announced, [{ type: 'workspace.changed', reloads: 1 }]);

	// A change that reloads nothing, such as identical declarations, announces nothing
	log.append('file.changed', { path: 'beyond.json', origin: 'api' });
	await until(() => workspace.refreshes === 2);
	await new Promise(resolve => setTimeout(resolve, 20));
	assert.equal(announced.length, 1);
});

test('only the files that declare the workspace refresh it, and a resync does', async () => {
	const { log, workspace } = setup();
	for (const path of ['web/main/index.ts', 'README.md', 'web/package.json.bak', 'beyond.jsonc']) log.append('file.changed', { path });
	log.append('build.ended', { path: 'beyond.json' });
	await new Promise(resolve => setTimeout(resolve, 20));
	assert.equal(workspace.refreshes, 0);

	assert.equal(Reloads.concerns({ type: 'file.created', path: 'api/server/module.json' }), true);
	assert.equal(Reloads.concerns({ type: 'file.deleted', path: 'beyond-lock.json' }), true);
	assert.equal(Reloads.concerns({ type: 'file.renamed', path: 'web/manifest.txt', from: 'web/package.json' }), true);
	log.append('resync', { reason: 'WATCHER' });
	await until(() => workspace.refreshes === 1);
});

test('a resync of the log, as a failed watcher of the File API brings it, refreshes the workspace and announces a reload', async () => {
	const { log, workspace, announced } = setup();
	// A manifest changed while the watcher was failing: no file event announced it
	workspace.changed = true;
	log.append('resync', { reason: 'WATCHER' });
	await until(() => announced.length === 1);
	assert.deepEqual(announced, [{ type: 'workspace.changed', reloads: 1 }]);

	// Another resync with nothing changed refreshes, and announces nothing
	log.append('resync', { reason: 'WATCHER' });
	await until(() => workspace.refreshes === 2);
	await new Promise(resolve => setTimeout(resolve, 20));
	assert.equal(announced.length, 1);
});

test('changes observed while a refresh runs are refreshed once after it, never in parallel', async () => {
	const { log, workspace, announced } = setup();
	workspace.changed = true;
	log.append('file.changed', { path: 'package.json' });
	for (let i = 0; i < 5; i++) log.append('file.changed', { path: 'web/module.json' });
	await until(() => workspace.refreshes === 2);
	await new Promise(resolve => setTimeout(resolve, 30));
	assert.equal(workspace.refreshes, 2, 'one refresh for the changes observed during the first');
	assert.deepEqual(announced, [{ type: 'workspace.changed', reloads: 1 }]);
});

test('a reload made by another request is announced by the next refresh that observes it', async () => {
	const { log, workspace, announced } = setup();
	workspace.reloads = 3;
	log.append('file.changed', { path: 'beyond-lock.json' });
	await until(() => announced.length === 1);
	assert.deepEqual(announced, [{ type: 'workspace.changed', reloads: 3 }]);
});

test('a refresh that fails is reported, announces nothing, and the next change tries again', async () => {
	const { log, workspace, announced, messages } = setup();
	workspace.changed = true;
	workspace.failing = true;
	log.append('file.changed', { path: 'package.json' });
	await until(() => messages.length === 1);
	assert.match(messages[0], /the workspace was not reloaded: the reload failed/);
	assert.equal(announced.length, 0);

	workspace.failing = false;
	log.append('file.changed', { path: 'package.json' });
	await until(() => announced.length === 1);
	assert.deepEqual(announced, [{ type: 'workspace.changed', reloads: 1 }]);
});

test('a refresh that never settles is given up after its bound, and the next change is refreshed', async () => {
	const { log, workspace, announced, messages, reloads } = setup(50);
	workspace.stalled = true;
	const started = Date.now();
	log.append('file.changed', { path: 'package.json' });
	await reloads.refresh();
	assert.ok(Date.now() - started < 1000, 'the wait ended within its bound');
	assert.match(messages.join('\n'), /did not end within 50ms/);

	workspace.stalled = false;
	workspace.changed = true;
	log.append('file.changed', { path: 'package.json' });
	await until(() => announced.length === 1);
	assert.equal(announced[0].reloads, 1);
});

test('without the development extension nothing is followed, and stopping releases the log', () => {
	const workspace = new Workspace();
	const reloads = new Reloads({ workspace, events: { emit: () => assert.fail('nothing to announce') } }).start(void 0);
	reloads.stop();

	const { log, reloads: following } = setup();
	assert.equal(log.size, 1);
	following.stop();
	assert.equal(log.size, 0);
});

test('the bound is the deadline of the hosted workspace and a margin, from the environment without it', () => {
	const workspace = new Workspace();
	const events = { emit: () => void 0 };
	const { MARGIN } = Reloads;
	assert.equal(new Reloads({ workspace, events, environment: {} }).bound, 120000 + MARGIN);
	assert.equal(new Reloads({ workspace, events, environment: { BEYOND_WORKSPACE_TIMEOUT: '1000' } }).bound, 1000 + MARGIN);
	assert.throws(() => new Reloads({ workspace, events, environment: { BEYOND_WORKSPACE_TIMEOUT: 'soon' } }), /whole number/);

	// The deadline the host gives the workspace wins over the environment, and an explicit bound over both
	assert.equal(new Reloads({ workspace, events, deadline: 300000, environment: { BEYOND_WORKSPACE_TIMEOUT: 'soon' } }).bound, 300000 + MARGIN);
	assert.equal(new Reloads({ workspace, events, deadline: 300000, bound: 50 }).bound, 50);
});
