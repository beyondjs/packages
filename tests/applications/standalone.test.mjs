import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JSON_TYPE, Served } from './support/served.mjs';

/**
 * A standalone package that declares its first application, on the real development service over a copy of
 * `fixtures/standalone`: a `beyond.json` without `packages` holds the applications and never decides the kind, so its
 * creation leaves the package `standalone`, its declaration digest and the state of its installed graph as they were,
 * while the catalog lists the application. The package has no dependency, so its installation requests nothing; the
 * source store and the metadata cache are directories of the case.
 */
const served = new Served('standalone');
const stores = mkdtempSync(join(tmpdir(), 'beyond applications stores '));
let events;
before(async () => {
	process.env.BEYOND_SOURCES_DIR = join(stores, 'sources');
	process.env.BEYOND_METADATA_DIR = join(stores, 'metadata');
	await served.start({ runtime: false });
	events = await served.stream('/events');
	await events.until('subscribed');
}, { timeout: 600000 });
after(async () => {
	events?.close();
	await served.stop();
	rmSync(stores, { recursive: true, force: true });
}, { timeout: 120000 });

const file = path => join(served.root, ...path.split('/'));
const installation = async () => (await served.send('GET', '/installation')).body;

test('declaring the first application keeps the kind, the declaration digest and the installed graph of a standalone package', async () => {
	const installed = await served.send('POST', '/installation', { headers: { ...served.headers, ...JSON_TYPE }, body: {} });
	assert.equal(installed.status, 200, JSON.stringify(installed.body));
	assert.equal(installed.body.valid, true, JSON.stringify(installed.body.diagnostics));
	const before = await installation();
	assert.deepEqual([before.state, before.declaration.kind, before.declaration.members.map(({ id }) => id)], ['ready', 'standalone', ['.']]);
	const lock = readFileSync(file('beyond-lock.json'), 'utf8');

	const declaration = { applications: { site: { title: 'Site', targets: { web: { title: 'Web page', kind: 'frontend', package: '@standalone/site', entry: './main' } } } } };
	events.mark();
	writeFileSync(file('beyond.json'), `${JSON.stringify(declaration, null, '\t')}\n`);
	await events.until('applications.changed', 120000);

	const afterwards = await installation();
	assert.deepEqual([afterwards.state, afterwards.declaration.kind, afterwards.declaration.diagnostics], ['ready', 'standalone', []], JSON.stringify(afterwards));
	assert.deepEqual(afterwards.diagnostics, [], 'the projection still matches the declaration it was written from');
	assert.equal(readFileSync(file('beyond-lock.json'), 'utf8'), lock, 'nothing was installed again');
	const { body: catalog } = await served.send('GET', '/applications');
	assert.deepEqual(catalog.applications.map(({ id, targets }) => [id, targets.map(({ id: target }) => target)]), [['site', ['web']]]);
});
