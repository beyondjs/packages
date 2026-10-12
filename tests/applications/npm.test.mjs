import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Served } from './support/served.mjs';

/**
 * A workspace whose members npm's `workspaces` declare, beside a `beyond.json` that holds only its applications, on the
 * real development service over a copy of `fixtures/npm`: no conflict, the members served, the applications listed and
 * resolved; a `beyond.json` that also declares `packages` is still the conflict it was, and removing them recovers.
 */
const served = new Served('npm');
let events;
before(async () => {
	await served.start();
	events = await served.stream('/events');
	await events.until('subscribed');
}, { timeout: 600000 });
after(async () => {
	events?.close();
	await served.stop();
}, { timeout: 120000 });

const file = path => join(served.root, ...path.split('/'));
const state = async () => (await served.send('GET', '/state')).body;
const codes = ({ diagnostics }) => diagnostics.map(({ code }) => code);
const module = (described, specifier) => described.modules.find(one => one.specifier === specifier);

test('a beyond.json of applications beside npm workspaces is no conflict: the members are served and the applications listed', async () => {
	const described = await state();
	assert.equal(codes(described).includes('WORKSPACE_CONFIG_CONFLICT'), false, JSON.stringify(described.diagnostics));
	assert.equal(module(described, '@npm/web/main')?.status, 'valid');

	const { body: catalog } = await served.send('GET', '/applications');
	assert.deepEqual([catalog.document.path, catalog.document.branch, catalog.diagnostics], ['beyond.json', 'inline', []]);
	assert.deepEqual(catalog.applications.map(({ id, targets }) => [id, targets.map(({ id: target }) => target)]), [['site', ['web']]]);

	const { body: target } = await served.send('GET', '/applications/site/targets/web');
	assert.deepEqual([target.entry.vspecifier, target.build.state, target.open.preview], ['@npm/web@1.0.0/main', 'built', '/preview/?entry=%40npm%2Fweb%2Fmain']);
});

test('a beyond.json that also declares packages is the conflict it was, announced and recovered', async () => {
	const original = readFileSync(file('beyond.json'), 'utf8');
	events.mark();
	writeFileSync(file('beyond.json'), JSON.stringify({ packages: ['packages/web'], ...JSON.parse(original) }, null, '\t'));
	const reloaded = await events.until('workspace.changed', 120000);
	const conflicting = await state();
	assert.ok(codes(conflicting).includes('WORKSPACE_CONFIG_CONFLICT'), JSON.stringify(conflicting.diagnostics));
	assert.equal(module(conflicting, '@npm/web/main'), undefined, 'a declaration in conflict declares no member');
	// The applications are read all the same: they are not what the conflict is about
	assert.deepEqual((await served.send('GET', '/applications')).body.applications.map(({ id }) => id), ['site']);

	events.mark();
	writeFileSync(file('beyond.json'), original);
	const recovered = await events.until(event => event.type === 'workspace.changed' && event.data.reloads > reloaded.data.reloads, 120000);
	assert.ok(recovered.data.reloads > reloaded.data.reloads);
	const described = await state();
	assert.equal(codes(described).includes('WORKSPACE_CONFIG_CONFLICT'), false);
	assert.equal(module(described, '@npm/web/main')?.status, 'valid');
});
