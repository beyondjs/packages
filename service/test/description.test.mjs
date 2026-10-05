import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Session } from '@beyond-js/artifact-api';
import { Composition } from '../host/composition.mjs';
import { Description } from '../host/description.mjs';

const ROOT = '/ws';
const DEVELOPMENT = '@beyond-js/packages/development';

// What the toolchain offers a Node consumer: its own runtime and the libraries of its supplied adapters
const RUNTIME = { packages: ['@beyond-js/kernel', 'react', 'vue'], base: 'file:///installed/package.json' };

const module = (name, version, subpath = './main') => ({
	specifier: `${name}/${subpath.slice(2)}`,
	vspecifier: `${name}@${version}/${subpath.slice(2)}`,
	name,
	version,
	subpath,
	path: `${ROOT}/${name.split('/').pop()}-${version}`
});

/**
 * A hosted workspace as the description reads it, with the composition of its generation. `installed` gives it
 * an installed graph that provides `react`, or every name of `provided`; `versions` publishes a second version of
 * `@fixture/widget`.
 */
const hosted = ({ installed = false, versions = false, provided = ['react'] } = {}) => ({
	published: async () => [
		module('@fixture/app', '1.0.0'),
		module('@fixture/widget', '1.0.0'),
		...(versions ? [module('@fixture/widget', '2.0.0')] : [])
	],
	module: async () => ({ delivered: { hash: 'h1', dependencies: [] } }),
	diagnostics: async () => [{ code: 'PACKAGE_DUPLICATED', message: 'twice', file: `${ROOT}/app/package.json` }],
	declared: {
		diagnostics: [
			{ code: 'WORKSPACE_PATTERN_EMPTY', message: 'nothing matches "libs/*"', severity: 'warning', paths: [`${ROOT}/package.json`] },
			{ code: 'MEMBER_MANIFEST_INVALID', message: 'no version', severity: 'error', paths: ['/elsewhere/package.json'] }
		]
	},
	projection: installed
		? { state: 'stale', diagnostics: [{ code: 'EXECUTION_GRAPH_STALE', message: 'run beyond install', severity: 'error' }] }
		: { state: 'missing', diagnostics: [{ code: 'EXECUTION_GRAPH_MISSING', message: 'run beyond install', severity: 'error' }] },
	composition: new Composition(
		{ members: [] },
		installed ? { state: 'stale', diagnostics: [], execution: { find: name => (provided.includes(name) ? [`npm:${name}@1.0.0`] : []) } } : { state: 'missing', diagnostics: [] },
		{ runtime: RUNTIME }
	),
	provenance: async () => [{ name: '@fixture/app', version: '1.0.0', source: 'workspace', node: null, location: `${ROOT}/app` }]
});

const settings = (extra = {}) => ({
	root: ROOT,
	standalone: false,
	toolchain: 'toolchain-id',
	versions: {},
	runtime: RUNTIME,
	...extra
});

const described = (delivery, extra) => {
	const description = new Description(settings(extra), delivery);
	description.origin = 'http://127.0.0.1:1';
	return description;
};

test('the session lists the extensions of the service and stays a valid session description', async () => {
	const session = await described(hosted(), { extensions: [DEVELOPMENT] }).session();
	assert.deepEqual(session.service.extensions, [DEVELOPMENT]);
	assert.doesNotThrow(() => new Session(session));

	const none = await described(hosted()).session();
	assert.deepEqual(none.service.extensions, [], 'a service started without extensions says so');
});

test('without an installed graph the runtime of the session is the one of the installation', async () => {
	const session = await described(hosted()).session();
	assert.deepEqual(session.runtime, RUNTIME);
});

test('with an installed graph, only the toolchain\'s own runtime is resolved from the installation (D10, A13)', async () => {
	// React is in the graph and Vue is not: neither is resolved from the installation, whose adapters were dropped
	const session = await described(hosted({ installed: true })).session();
	assert.deepEqual(session.runtime.packages, ['@beyond-js/kernel']);
	assert.equal(session.runtime.base, 'file:///installed/package.json');
	assert.doesNotThrow(() => new Session(session));

	const provided = await described(hosted({ installed: true, provided: ['@beyond-js/kernel'] })).session();
	assert.deepEqual(provided.runtime.packages, [], 'a graph that provides the Kernel leaves nothing to the installation');
	assert.doesNotThrow(() => new Session(provided));
});

test('a specifier that several local versions publish is described by each versioned identity, never by one of them', async () => {
	const { modules } = await described(hosted({ versions: true })).session();
	assert.deepEqual(Object.keys(modules).sort(), ['@fixture/app/main', '@fixture/widget@1.0.0/main', '@fixture/widget@2.0.0/main']);
	assert.equal(modules['@fixture/widget@2.0.0/main'].vspecifier, '@fixture/widget@2.0.0/main');
	assert.equal(modules['@fixture/widget@2.0.0/main'].path, '/m/@fixture/widget@2.0.0/modules/main');
});

test('the state reports the installation, where each package comes from and the diagnostics of the declaration', async () => {
	const state = await described(hosted({ installed: true })).state();

	assert.deepEqual(state.installation, {
		state: 'stale',
		diagnostics: [{ code: 'EXECUTION_GRAPH_STALE', message: 'run beyond install', severity: 'error' }]
	});
	assert.deepEqual(state.packages, [{ name: '@fixture/app', version: '1.0.0', source: 'workspace', node: null, location: `${ROOT}/app` }]);
	assert.deepEqual(state.diagnostics, [
		{ code: 'WORKSPACE_PATTERN_EMPTY', message: 'nothing matches "libs/*"', severity: 'warning', paths: ['package.json'] },
		{ code: 'MEMBER_MANIFEST_INVALID', message: 'no version', severity: 'error', paths: ['/elsewhere/package.json'] },
		{ code: 'PACKAGE_DUPLICATED', message: 'twice', file: 'app/package.json' }
	]);
	assert.deepEqual(state.modules.map(({ status }) => status), ['valid', 'valid']);
});

test('a hosted workspace that knows nothing of installation is still described', async () => {
	const legacy = {
		published: async () => [module('@fixture/app', '1.0.0')],
		module: async () => ({ delivered: { hash: 'h1', dependencies: [] } }),
		diagnostics: async () => []
	};
	const description = described(legacy);
	const state = await description.state();
	assert.equal('installation' in state, false);
	assert.deepEqual(state.packages, []);
	assert.deepEqual(state.diagnostics, []);
	assert.deepEqual((await description.session()).runtime, RUNTIME, 'the runtime of the settings, as given');
});
