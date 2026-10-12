import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import Ajv from 'ajv/dist/2020.js';
import { JSON_TYPE, Served } from './support/served.mjs';

/**
 * The catalog of applications (`beyond-applications/1`) on the real development service started from this checkout,
 * over a copy of `fixtures/workspace`: the catalog and the resolved targets, the writes of one application with their
 * preconditions and what they keep of the document, who may read and write, and the declarations that are refused.
 */
const UI = 'https://ui.example';
const EVIL = 'https://evil.example';
const code = answer => [answer.status, answer.body?.error?.code];

// Every document the service answers is checked against the contract's schema
const schema = JSON.parse(readFileSync(new URL('../../contracts/applications/schema.json', import.meta.url), 'utf8'));
const ajv = new Ajv({ strict: true, strictRequired: false, allErrors: true });
ajv.addSchema(schema);
const conforms = (definition, document) => {
	const validate = ajv.getSchema(`${schema.$id}#/$defs/${definition}`);
	assert.ok(validate(document), `${definition}: ${JSON.stringify(validate.errors)}`);
	return document;
};

const served = new Served('workspace');
before(() => served.start({ pairing: { origins: [UI] } }), { timeout: 600000 });
after(() => served.stop(), { timeout: 120000 });

const file = path => join(served.root, ...path.split('/'));
const read = path => readFileSync(file(path), 'utf8');
const catalog = async () => (await served.send('GET', '/applications')).body;
const put = (id, value, headers) => served.send('PUT', `/applications/${id}`, { headers: { ...served.headers, ...JSON_TYPE, ...headers }, body: value });
const remove = (id, headers) => served.send('DELETE', `/applications/${id}`, { headers: { ...served.headers, ...headers } });
const match = revision => ({ 'if-match': `"${revision}"` });
const ORIGINAL = () => readFileSync(new URL('./fixtures/workspace/beyond.json', import.meta.url), 'utf8');

/**
 * Writes beyond.json as another program would, and waits for the catalog to read it
 */
const declare = async (content, settled) => {
	writeFileSync(file('beyond.json'), typeof content === 'string' ? content : `${JSON.stringify(content, null, '\t')}\n`);
	const deadline = Date.now() + 30000;
	for (;;) {
		const current = await catalog();
		if (settled(current)) return current;
		if (Date.now() > deadline) throw new Error(`The catalog did not read the declaration: ${JSON.stringify(current)}`);
		await new Promise(resolve => setTimeout(resolve, 100));
	}
};

test('the session advertises the catalog, which lists the declared applications and targets in their order', async () => {
	assert.equal(served.session.capabilities.applications, 1);
	const { protocol, generation, document, following, applications, diagnostics } = conforms('catalog', await catalog());
	assert.equal(protocol, 'beyond-applications/1');
	assert.deepEqual([following.live, following.events, ['starting', 'ready'].includes(following.watchers)], [true, true, true]);
	assert.ok(generation >= 1);
	assert.deepEqual({ ...document, revision: void 0 }, { path: 'beyond.json', branch: 'inline', exists: true, revision: void 0 });
	assert.match(document.revision, /^sha256-[0-9a-f]{64}$/);
	assert.deepEqual(diagnostics, []);

	const [composition] = applications;
	assert.deepEqual([applications.length, composition.id, composition.title], [1, 'composition', 'Composition']);
	assert.deepEqual(composition.targets.map(({ id, kind, specifier, environment }) => [id, kind, specifier, environment]), [
		['web', 'frontend', '@applications/web/main', 'browser'],
		['api', 'backend', '@applications/api/server', 'node']
	]);
	assert.deepEqual(composition.targets[1].readiness, { output: 'applications api listening' });
	// A library module of the workspace is discoverable and importable, and no target unless one declares it
	assert.equal(JSON.stringify(applications).includes('@applications/web/widget'), false);
});

test('a frontend target resolves to its entry, its browser output, its composition and its preview document', async () => {
	const { status, body } = await served.send('GET', '/applications/composition/targets/web');
	assert.equal(status, 200, JSON.stringify(body));
	conforms('resolved', body);
	assert.deepEqual(body.entry, {
		specifier: '@applications/web/main',
		vspecifier: '@applications/web@1.0.0/main',
		package: { name: '@applications/web', version: '1.0.0', source: 'workspace', selected: true }
	});
	assert.deepEqual([body.environment, body.build.platform, body.build.state], ['browser', 'web', 'built']);
	assert.equal(body.open.preview, '/preview/?entry=%40applications%2Fweb%2Fmain');
	assert.equal(body.launch, undefined, 'a frontend target is opened, not launched');
	assert.ok(body.composition.modules.workspace >= 3, JSON.stringify(body.composition));
	assert.deepEqual(body.diagnostics, []);

	// The document it names is the preview the existing route serves on the preview listener
	const preview = await served.send('GET', body.open.preview, { headers: {}, listener: 'preview' });
	assert.equal(preview.status, 200);
	assert.match(preview.body, /<script type="module"/);
});

test('a backend target resolves to its Node output and can be launched; reading it starts nothing', async () => {
	const { status, body } = await served.send('GET', '/applications/composition/targets/api');
	assert.equal(status, 200, JSON.stringify(body));
	conforms('resolved', body);
	assert.deepEqual([body.entry.vspecifier, body.environment, body.build.platform, body.build.state], ['@applications/api@1.0.0/server', 'node', 'node', 'built']);
	assert.deepEqual(body.launch, { supported: true, specifier: '@applications/api/server' }, 'one local version is imported by its public specifier');
	assert.equal(body.open, undefined);
	assert.deepEqual(body.composition.modules, { workspace: 3 });
	assert.deepEqual(code(await served.send('GET', '/applications/composition/targets/nope')), [404, 'TARGET_NOT_FOUND']);
	assert.deepEqual(code(await served.send('GET', '/applications/nope/targets/web')), [404, 'APPLICATION_NOT_FOUND']);
});

test('a target whose entry or environment cannot be resolved says why, and is not launchable', async () => {
	const targets = {
		'missing-package': { kind: 'backend', package: '@applications/nothing', entry: './server' },
		'missing-entry': { kind: 'frontend', package: '@applications/web', entry: './nothing' },
		'no-browser': { kind: 'frontend', package: '@applications/api', entry: './server' },
		deno: { kind: 'backend', package: '@applications/api', entry: './server', runtime: 'deno>=2' },
		bun: { kind: 'backend', package: '@applications/api', entry: './server', runtime: 'bun' }
	};
	const { revision } = (await catalog()).document;
	const created = await put('probe', { title: 'Probe', targets }, match(revision));
	assert.equal(created.status, 200, JSON.stringify(created.body));
	const resolve = async target => conforms('resolved', (await served.send('GET', `/applications/probe/targets/${target}`)).body);
	const codes = body => body.diagnostics.map(({ code }) => code);

	const missing = await resolve('missing-package');
	assert.deepEqual([codes(missing), missing.launch], [['TARGET_PACKAGE_NOT_FOUND'], { supported: false, reason: 'TARGET_PACKAGE_NOT_FOUND' }]);
	assert.deepEqual(codes(await resolve('missing-entry')), ['TARGET_ENTRY_NOT_FOUND']);
	const browser = await resolve('no-browser');
	assert.deepEqual([codes(browser), browser.build.state, browser.open], [['TARGET_ENVIRONMENT_UNSUPPORTED'], 'unsupported', undefined]);
	const deno = await resolve('deno');
	assert.deepEqual([deno.environment, deno.launch], ['deno', { supported: true, requires: 'deno', specifier: '@applications/api/server' }]);
	const bun = await resolve('bun');
	const declared = bun.declared.diagnostics.map(({ code, severity }) => [code, severity]);
	assert.deepEqual([declared, bun.launch], [[['TARGET_RUNTIME_UNSUPPORTED', 'warning']], { supported: false, reason: 'TARGET_RUNTIME_UNSUPPORTED' }]);
	assert.equal((await remove('probe', match(created.body.revision))).status, 200);
});

test('writes create, replace and remove one application with the revision of the document, and keep the rest of it', async () => {
	const before = await catalog();
	const original = read('beyond.json');

	// Created with If-None-Match: *, which a second creation conflicts with
	const site = { title: 'Site', targets: { web: { title: 'Web page', kind: 'frontend', package: '@applications/web', entry: './main' } } };
	const created = await put('site', site, { 'if-none-match': '*' });
	assert.equal(created.status, 200, JSON.stringify(created.body));
	conforms('written', created.body);
	assert.equal(created.body.outcome, 'completed');
	assert.notEqual(created.body.revision, before.document.revision);
	assert.equal(created.body.catalog.document.revision, created.body.revision);
	assert.ok(created.body.catalog.generation > before.generation);
	assert.deepEqual(created.body.catalog.applications.map(({ id }) => id), ['composition', 'site']);
	const again = await put('site', site, { 'if-none-match': '*' });
	conforms('written', again.body);
	assert.deepEqual([again.status, again.body.outcome, again.body.revision], [409, 'conflict', created.body.revision]);

	// What else the document holds is kept as written: the unrelated fields, the order, the tabs, the final newline
	const text = read('beyond.json');
	assert.equal(text.slice(0, original.lastIndexOf('\n\t}\n}')), original.slice(0, original.lastIndexOf('\n\t}\n}')));
	assert.match(text, /\n\t\t"site": \{\n\t\t\t"title": "Site",/);
	assert.ok(text.endsWith('\n\t}\n}\n'));

	// Replaced with If-Match: only what changed is rewritten, and a one-line target that did not change stays one line
	const replaced = await put('composition', { ...JSON.parse(original).applications.composition, title: 'Composition renamed' }, match(created.body.revision));
	assert.equal(replaced.status, 200, JSON.stringify(replaced.body));
	assert.equal(read('beyond.json'), text.replace('"title": "Composition"', '"title": "Composition renamed"'));
	const stale = await put('composition', { title: 'Late' }, match(created.body.revision));
	assert.deepEqual([stale.status, stale.body.outcome, stale.body.revision], [409, 'conflict', replaced.body.revision]);

	// Removed with If-Match; removing what does not exist is 404
	const removed = await remove('site', match(replaced.body.revision));
	assert.equal(removed.status, 200, JSON.stringify(removed.body));
	assert.equal(read('beyond.json'), original.replace('"title": "Composition"', '"title": "Composition renamed"'));
	assert.deepEqual(code(await remove('site', match(removed.body.revision))), [404, 'APPLICATION_NOT_FOUND']);
	await put('composition', JSON.parse(original).applications.composition, match(removed.body.revision));
	assert.equal(read('beyond.json'), original);
});

test('a write states its precondition, is sent as JSON and is validated before anything is written', async () => {
	const { revision } = (await catalog()).document;
	const value = { title: 'X' };
	assert.deepEqual(code(await put('x', value)), [428, 'PRECONDITION_REQUIRED']);
	assert.deepEqual(code(await remove('composition')), [428, 'PRECONDITION_REQUIRED']);
	assert.deepEqual(code(await put('x', value, { ...match(revision), 'content-type': 'text/plain' })), [415, 'CONTENT_TYPE_UNSUPPORTED']);
	assert.deepEqual(code(await served.send('PUT', '/applications/x', { headers: { ...served.headers, ...JSON_TYPE, ...match(revision) }, body: '{"title":' })), [400, 'BODY_INVALID']);

	const invalid = await put('Bad_Id', { title: '', targets: { web: { kind: 'mobile', package: 'Not A Name', entry: 'main', conditions: ['b', 'a'] } } }, match(revision));
	assert.equal(invalid.status, 422);
	conforms('refusal', invalid.body);
	assert.equal(invalid.body.error.code, 'APPLICATION_INVALID');
	const found = invalid.body.error.diagnostics.map(({ code, target }) => (target ? `${target}:${code}` : code));
	assert.deepEqual(found.sort(), ['APPLICATION_ID_INVALID', 'APPLICATION_TITLE_INVALID', 'web:TARGET_CONDITIONS_INVALID', 'web:TARGET_ENTRY_INVALID', 'web:TARGET_KIND_INVALID', 'web:TARGET_PACKAGE_REQUIRED']);
	assert.deepEqual(code(await put('x', [1, 2], match(revision))), [422, 'APPLICATION_INVALID']);
	assert.equal((await catalog()).document.revision, revision, 'nothing was written');
});

test('who may read and write the catalog: a local tool and a paired page, never a local consumer or another site', async () => {
	// A process of this machine without the credential reads only what a consumer of modules needs, as with /declarations
	assert.deepEqual(code(await served.send('GET', '/applications', { headers: {} })), [401, 'CREDENTIAL_REQUIRED']);
	assert.deepEqual(code(await served.send('GET', '/applications/composition/targets/web', { headers: {} })), [401, 'CREDENTIAL_REQUIRED']);
	assert.deepEqual(code(await served.send('PUT', '/applications/x', { headers: { ...JSON_TYPE, 'if-none-match': '*' }, body: '{}' })), [401, 'CREDENTIAL_REQUIRED']);
	assert.deepEqual(code(await served.send('GET', '/applications', { headers: { origin: EVIL } })), [401, 'PAIRING_REQUIRED']);
	assert.deepEqual(code(await served.send('PUT', '/applications/x', { headers: { origin: EVIL, 'content-type': 'text/plain', 'if-none-match': '*' }, body: '{}' })), [401, 'PAIRING_REQUIRED']);

	const { code: pairing } = await served.pairing.code();
	const paired = await served.send('POST', '/pairing', { headers: { origin: UI, ...JSON_TYPE }, body: JSON.stringify({ code: pairing }) });
	const page = { origin: UI, authorization: `Bearer ${paired.body.token}` };
	const read = await served.send('GET', '/applications', { headers: page });
	assert.deepEqual([read.status, read.headers['access-control-allow-origin']], [200, UI]);
	const written = await served.send('PUT', '/applications/paired', { headers: { ...page, ...JSON_TYPE, 'if-none-match': '*' }, body: JSON.stringify({ title: 'Paired' }) });
	assert.equal(written.status, 200, JSON.stringify(written.body));
	const removed = await served.send('DELETE', '/applications/paired', { headers: { ...page, ...match(written.body.revision) } });
	assert.equal(removed.status, 200);

	await served.pairing.revoke(paired.body.pairing.id);
	assert.deepEqual(code(await served.send('GET', '/applications', { headers: page })), [401, 'PAIRING_REVOKED']);
	assert.deepEqual(code(await served.send('GET', '/applications/composition/targets/web', { headers: page })), [401, 'PAIRING_REVOKED']);
});

test('a branch in a file of the workspace is read from it and written to it, beyond.json unchanged', async t => {
	t.after(() => writeFileSync(file('beyond.json'), ORIGINAL()));
	const declared = { ...JSON.parse(ORIGINAL()), applications: 'config/applications.json' };
	const current = await declare(declared, ({ document }) => document.path === 'config/applications.json');
	assert.deepEqual({ ...current.document, revision: void 0 }, { path: 'config/applications.json', branch: 'file', exists: true, reference: 'config/applications.json', revision: void 0 });
	assert.deepEqual(current.applications.map(({ id }) => id), ['site']);

	const beyond = read('beyond.json');
	const named = read('config/applications.json');
	const site = JSON.parse(named).site;
	const written = await put('site', { ...site, title: 'Site renamed' }, match(current.document.revision));
	assert.equal(written.status, 200, JSON.stringify(written.body));
	assert.equal(read('config/applications.json'), named.replace('"title": "Site"', '"title": "Site renamed"'));
	assert.equal(read('beyond.json'), beyond, 'the branch stays a file');
	assert.equal(written.body.catalog.applications[0].title, 'Site renamed');

	// The revision of beyond.json does not stand for the file's
	const root = `sha256-${createHash('sha256').update(readFileSync(file('beyond.json'))).digest('hex')}`;
	const stale = await put('site', site, match(root));
	assert.deepEqual([stale.status, stale.body.revision], [409, written.body.revision]);
});

test('a list, a file outside the workspace and a missing file are refused or reported, never read in part', async t => {
	t.after(() => writeFileSync(file('beyond.json'), ORIGINAL()));
	const base = JSON.parse(ORIGINAL());
	const codes = body => body.diagnostics.map(({ code }) => code);

	const listed = conforms('catalog', await declare({ ...base, applications: [{ path: 'config', site: {} }] }, ({ diagnostics }) => diagnostics.length > 0));
	assert.deepEqual([codes(listed), listed.applications], [['APPLICATIONS_ARRAY_UNSUPPORTED'], []]);
	assert.deepEqual(code(await put('x', { title: 'X' }, match(listed.document.revision))), [422, 'APPLICATIONS_ARRAY_UNSUPPORTED']);

	// Outside the root: by its path, through a link, in repository internals; its content is never read or disclosed
	writeFileSync(join(served.outside, 'outside.json'), JSON.stringify({ leaked: { title: 'OUTSIDE-SECRET' } }));
	symlinkSync(join(served.outside, 'outside.json'), file('config/linked.json'));
	let fifo = false;
	try {
		execFileSync('mkfifo', [join(served.outside, 'outside.fifo')]);
		fifo = true;
	} catch {
		t.diagnostic('mkfifo is not available: the case of a FIFO outside the workspace is not run');
	}
	for (const reference of ['../outside.json', 'config/linked.json', '.git/applications.json', '/etc/hosts', ...(fifo ? ['../outside.fifo'] : [])]) {
		const outside = conforms('catalog', await declare({ ...base, applications: reference }, ({ document }) => document.reference === reference));
		assert.deepEqual([codes(outside), outside.applications], [['APPLICATIONS_FILE_OUTSIDE'], []], reference);
		assert.equal(JSON.stringify(outside).includes('OUTSIDE-SECRET'), false);
		assert.deepEqual(code(await put('x', { title: 'X' }, match(outside.document.revision))), [422, 'APPLICATIONS_FILE_OUTSIDE'], reference);
	}

	// A missing file is reported, and the first creation writes it
	const missing = conforms('catalog', await declare({ ...base, applications: 'config/missing.json' }, ({ document }) => document.reference === 'config/missing.json'));
	assert.deepEqual([codes(missing), missing.document.exists, missing.document.path], [['APPLICATIONS_FILE_MISSING'], false, 'config/missing.json']);
	const created = await put('fresh', { title: 'Fresh' }, { 'if-none-match': '*' });
	assert.equal(created.status, 200, JSON.stringify(created.body));
	assert.equal(read('config/missing.json'), '{\n\t"fresh": {\n\t\t"title": "Fresh"\n\t}\n}\n');
	assert.deepEqual([codes(created.body.catalog), created.body.catalog.applications.map(({ id }) => id)], [[], ['fresh']]);

	// A malformed owning document is not rewritten
	const malformed = await declare('{ "packages": [', ({ diagnostics }) => diagnostics.some(({ code }) => code === 'APPLICATIONS_FILE_INVALID'));
	assert.deepEqual(code(await put('x', { title: 'X' }, match(malformed.document.revision))), [422, 'APPLICATIONS_FILE_INVALID']);
	assert.equal(read('beyond.json'), '{ "packages": [');
});

test('a branch that names a manifest, the lock or the state of the service is refused, and no write reaches it', async t => {
	t.after(() => writeFileSync(file('beyond.json'), ORIGINAL()));
	const base = JSON.parse(ORIGINAL());
	const manifest = read('web/package.json');
	for (const reference of ['web/package.json', 'web/main/module.json', 'beyond-lock.json', 'config/beyond.json', '.beyond/applications.json', 'beyond.json']) {
		const refused = conforms('catalog', await declare({ ...base, applications: reference }, ({ document }) => document.reference === reference));
		assert.deepEqual([refused.diagnostics.map(({ code: one }) => one), refused.applications], [['APPLICATIONS_FILE_INVALID'], []], reference);
		// "name" would be a field of the manifest if its fields were read as applications
		assert.deepEqual(code(await put('name', { title: 'X' }, match(refused.document.revision))), [422, 'APPLICATIONS_FILE_INVALID'], reference);
		assert.deepEqual(code(await remove('name', match(refused.document.revision))), [422, 'APPLICATIONS_FILE_INVALID'], reference);
	}
	assert.equal(read('web/package.json'), manifest, 'no field of a manifest was removed or replaced');
});
