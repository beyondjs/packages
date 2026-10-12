/**
 * Contract: what `Installation` (`@beyond-js/packages/installation`) gives dependency management, through the public
 * specifier, against the in-process registries of `support/registry.mjs` and a copy of `fixtures/workspace`: a
 * resolution that installs nothing (`resolve`), the releases of names (`releases`), an installation with explicit
 * preferences and what it tells while it runs, their bounds and cancellation, and installations of one root from
 * several instances run one at a time. Run from the Packages directory under BEE Node with BEE_URL:
 * `node --import "$BEE_NODE_DIR/register.mjs" --test tests/dependencies/installation.test.mjs`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Installation } from '@beyond-js/packages/installation';
import { Declaration } from '../../service/workspace/declaration.mjs';
import { Registry } from './support/registry.mjs';

const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
const RELEASES = ['react@18.3.1', 'react@19.1.1', 'react-dom@18.3.1', 'scheduler@0.23.2', 'loose-envify@1.4.0', 'js-tokens@4.0.0', 'shared-lib@1.0.0', 'shared-lib@1.1.0', 'chart-kit@1.0.0', '@team/tokens@1.0.0', '@team/secret-sdk@1.0.0'];

/**
 * A copy of the fixture workspace with its registries, a store and a metadata cache of its own, removed with the case
 */
const copy = async t => {
	const directory = realpathSync(mkdtempSync(join(tmpdir(), 'beyond-installation-')));
	const root = join(directory, 'workspace');
	cpSync(join(FIXTURES, 'workspace'), root, { recursive: true });
	const [registry, team] = [new Registry(), new Registry({ token: 'team-token', denied: ['@team/secret-sdk'] })];
	await registry.start();
	await team.start();
	t.after(async () => {
		await registry.stop();
		await team.stop();
		rmSync(directory, { recursive: true, force: true });
	});
	for (const release of RELEASES) {
		const at = release.lastIndexOf('@');
		const [name, version] = [release.slice(0, at), release.slice(at + 1)];
		await (name.startsWith('@team/') ? team : registry).publish(join(FIXTURES, 'registry', name, version));
	}
	writeFileSync(join(root, '.npmrc'), `registry=${registry.url}\n@team:registry=${team.url}\n${team.key}:_authToken=team-token\n`);
	const params = (extra = {}) => {
		const declaration = Declaration.read(root);
		const members = declaration.members.map(({ id, name, version, path, manifest }) => ({ id, name, version, path, manifest }));
		const isolated = { user: false, global: false, env: false };
		return { root, members, inputs: declaration.inputs, manifest: declaration.manifest, store: join(directory, 'store'), metadata: join(directory, 'metadata'), providers: isolated, ...extra };
	};
	return { root, registry, team, params, lock: () => JSON.parse(readFileSync(join(root, 'beyond-lock.json'), 'utf8')) };
};
const versions = (graph, name) => Object.values(graph.nodes).filter(node => node.name === name).map(({ version }) => version).sort();

test('a resolution answers the graph and the lock it would write, with the releases asked for, and writes nothing', async t => {
	const workspace = await copy(t);
	const events = [];
	const resolution = await new Installation(workspace.params()).resolve({ names: ['shared-lib', 'nothing-here'], progress: event => events.push(event) });
	assert.equal(resolution.valid, true, JSON.stringify(resolution.diagnostics));
	assert.deepEqual(versions(resolution.graph, 'shared-lib'), ['1.1.0'], 'without a lock, the newest the range admits');
	assert.match(resolution.lock, /^sha256-[0-9a-f]{64}$/);
	assert.ok(resolution.requests > 0 && resolution.duration >= 0);
	assert.ok(resolution.diagnostics.some(({ code, severity }) => code === 'PROVIDER_AUTH_DENIED' && severity === 'warning'), 'the denied optional dependency');
	const [shared, nothing] = resolution.releases;
	assert.deepEqual([shared.found, shared.versions, shared.tags.latest, shared.access], [true, ['1.1.0', '1.0.0'], '1.1.0', 'public']);
	assert.deepEqual([nothing.found, nothing.error.code], [false, 'PACKAGE_NOT_FOUND']);
	assert.equal(events[0].phase, 'resolution');
	assert.ok(events.some(({ request }) => request?.kind === 'metadata' && request.answered));
	assert.ok(!existsSync(join(workspace.root, 'beyond-lock.json')) && !existsSync(join(workspace.root, '.beyond')), 'nothing is written');

	const installed = await new Installation(workspace.params()).install();
	assert.equal(installed.lock.digest, resolution.lock, 'the lock it said it would write');
});

test('an installation with preferences resolves even when the lock covers the inputs, and tells each phase', async t => {
	const workspace = await copy(t);
	const first = await new Installation(workspace.params()).install({ preferences: [{ name: 'shared-lib', version: '1.0.0' }] });
	assert.deepEqual([first.valid, versions(workspace.lock(), 'shared-lib')], [true, ['1.0.0']]);

	const events = [];
	const preferences = Object.values(workspace.lock().nodes).filter(node => node.origin.provider !== 'workspace').map(({ name, version }) => ({ name, version }));
	const second = await new Installation(workspace.params()).install({ preferences: [...preferences, { name: 'shared-lib', version: '1.1.0' }], progress: event => events.push(event) });
	assert.deepEqual([second.valid, second.frozen], [true, false], 'not frozen: the preferences are resolved');
	const lock = workspace.lock();
	assert.deepEqual(versions(lock, 'shared-lib'), ['1.1.0']);
	assert.deepEqual(versions(lock, 'react'), ['18.3.1'], 'what the preferences pin stays');
	const phases = events.filter(({ phase }) => phase).map(({ phase }) => phase);
	assert.deepEqual(phases, ['resolution', 'download', 'materialization']);
	assert.equal(events.find(({ phase }) => phase === 'download').total, Object.keys(lock.nodes).filter(key => !key.startsWith('workspace:')).length);
	assert.ok(events.some(({ request }) => request?.kind === 'archive' && request.answered), 'shared-lib 1.1.0 was fetched');

	const invalid = await new Installation(workspace.params()).install({ update: true, preferences });
	assert.deepEqual([invalid.valid, invalid.diagnostics[0].code], [false, 'INSTALLATION_OPTIONS_INVALID']);
	const offline = await new Installation(workspace.params()).install({ offline: true, preferences });
	assert.deepEqual([offline.valid, offline.diagnostics[0].code], [false, 'OFFLINE_UNAVAILABLE']);
	assert.match(offline.diagnostics[0].message, /Preferences resolve the workspace again/);
	assert.deepEqual(workspace.lock(), lock, 'neither wrote anything');
});

test('the releases of names say how each was read: public, private, denied, missing or unreachable', async t => {
	const workspace = await copy(t);
	const seen = [];
	const gone = new Registry();
	await gone.start();
	const address = gone.url;
	await gone.stop();
	writeFileSync(join(workspace.root, '.npmrc'), `${readFileSync(join(workspace.root, '.npmrc'), 'utf8')}@gone:registry=${address}\n`);
	const names = ['react', '@team/tokens', '@team/secret-sdk', 'left-pad', '@gone/thing', 'react'];
	const releases = await new Installation(workspace.params()).releases(names, { progress: item => seen.push(item) });
	assert.deepEqual(releases.map(({ name }) => name), ['react', '@team/tokens', '@team/secret-sdk', 'left-pad', '@gone/thing']);
	const [react, tokens, secret, missing, unreachable] = releases;
	assert.deepEqual([react.access, react.versions, react.registry], ['public', ['19.1.1', '18.3.1'], workspace.registry.url]);
	assert.deepEqual([tokens.access, tokens.registry], ['private', workspace.team.url]);
	assert.deepEqual([secret.access, secret.error.code], ['denied', 'PROVIDER_AUTH_DENIED']);
	assert.deepEqual([missing.found, missing.access, missing.error.code], [false, 'unknown', 'PACKAGE_NOT_FOUND']);
	assert.deepEqual([unreachable.access, unreachable.error.code], ['unknown', 'NETWORK_ERROR']);
	assert.deepEqual(seen.map(({ done, total }) => `${done}/${total}`).sort(), ['1/5', '2/5', '3/5', '4/5', '5/5']);
	await assert.rejects(new Installation(workspace.params()).releases('react'), /names/);
});

test('a resolution or a read of releases that gets no answer ends at its deadline, and a cancelled one at once', async t => {
	const workspace = await copy(t);
	const silent = () => new Promise(() => void 0);
	const started = Date.now();
	const late = await new Installation(workspace.params({ deadline: 300, transport: silent })).resolve();
	assert.deepEqual([late.valid, late.diagnostics[0].code], [false, 'RESOLUTION_TIMEOUT']);
	const unread = await new Installation(workspace.params({ deadline: 300, transport: silent })).releases(['react']);
	assert.equal(unread[0].error.code, 'RESOLUTION_TIMEOUT');
	assert.ok(Date.now() - started < 10000, 'both ended at their bound');

	const controller = new AbortController();
	const holding = (url, init) => new Promise((resolve, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason)));
	const pending = new Installation(workspace.params({ transport: holding })).resolve({ signal: controller.signal });
	controller.abort();
	const cancelled = await pending;
	assert.deepEqual([cancelled.valid, cancelled.diagnostics[0].code], [false, 'RESOLUTION_CANCELLED']);
});

test('installations of one root from two instances run one after the other', async t => {
	const workspace = await copy(t);
	const [one, two] = [new Installation(workspace.params()), new Installation(workspace.params())];
	const [first, second] = await Promise.all([one.install(), two.install()]);
	assert.deepEqual([first.valid, first.frozen], [true, false]);
	assert.deepEqual([second.valid, second.frozen], [true, true], 'the second found the lock the first wrote');
});
