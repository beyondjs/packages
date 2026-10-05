import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, realpathSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Composition } from '../host/composition.mjs';
import { Provenance } from '../host/provenance.mjs';

// The runtime of a session resolves from this installation of Packages, where the Kernel and Vue are installed
const BASE = new URL('../../package.json', import.meta.url).href;

/**
 * Where a package is installed beside Packages, and its version
 */
const installed = name => {
	const manifest = new URL(`../../node_modules/${name}/package.json`, import.meta.url);
	return { location: realpathSync(dirname(fileURLToPath(manifest))), version: JSON.parse(readFileSync(manifest, 'utf8')).version };
};
const KERNEL = installed('@beyond-js/kernel');
const VUE = installed('vue');

/**
 * A Packages workspace as the provenance reads it: its packages by key, ready, and which of them are supplied
 */
const workspace = (packages, supplied = []) => ({
	ready: Promise.resolve(),
	packages: new Map(packages.map(pkg => [pkg.path, { ...pkg, ready: Promise.resolve() }])),
	supplies: pkg => supplied.includes(pkg.path)
});

const declaration = { kind: 'npm', members: [{ id: 'app', name: 'app', version: '1.0.0', path: '/ws/app' }] };

/**
 * An installed graph of the member `app` and two store nodes, as `Execution` exposes it
 */
const execution = {
	nodes: new Map([
		['workspace:app', { name: 'app', version: '1.0.0', location: '/ws/app' }],
		['npm:scheduler@0.26.0', { name: 'scheduler', version: '0.26.0', location: '/store/scheduler/files' }],
		['npm:react@19.1.1', { name: 'react', version: '19.1.1', location: '/store/react/files' }]
	]),
	instance: path => (path === '/ws/app' ? 'workspace:app' : void 0),
	find: name => [...execution.nodes].filter(([, node]) => node.name === name).map(([key]) => key)
};

test('without an installed graph: the members, the supplied packages and the runtime of the installation', async () => {
	const packages = [
		{ name: 'app', version: '1.0.0', path: '/ws/app' },
		{ name: '@beyond-js/widgets', version: '0.9.0', path: '/toolchain/widgets' }
	];
	const runtime = { packages: ['@beyond-js/kernel', 'vue', 'a-package-that-is-not-installed'], base: BASE };
	const composition = new Composition(declaration, { state: 'missing', diagnostics: [] }, { runtime });
	const listed = await new Provenance(workspace(packages, ['/toolchain/widgets']), composition).list();

	assert.deepEqual(listed, [
		{ name: 'app', version: '1.0.0', source: 'workspace', node: null, location: '/ws/app' },
		{ name: '@beyond-js/widgets', version: '0.9.0', source: 'supplied', node: null, location: '/toolchain/widgets' },
		{ name: '@beyond-js/kernel', version: KERNEL.version, source: 'installation', node: null, location: KERNEL.location },
		{ name: 'vue', version: VUE.version, source: 'installation', node: null, location: VUE.location },
		{ name: 'a-package-that-is-not-installed', version: null, source: 'installation', node: null, location: null }
	]);
});

test('with an installed graph: members by their node, store nodes by key, and only the toolchain\'s own runtime', async () => {
	// Vue is installed beside the toolchain for its Vue adapter, which an installed graph drops, and React is in the
	// graph: neither is resolved from the installation (A13)
	const runtime = { packages: ['@beyond-js/kernel', 'react', 'vue'], base: BASE };
	const composition = new Composition(declaration, { state: 'ready', diagnostics: [], execution }, { runtime });
	const listed = await new Provenance(workspace([{ name: 'app', version: '1.0.0', path: '/ws/app' }]), composition).list();

	assert.deepEqual(listed, [
		{ name: 'app', version: '1.0.0', source: 'workspace', node: 'workspace:app', location: '/ws/app' },
		{ name: 'react', version: '19.1.1', source: 'store', node: 'npm:react@19.1.1', location: '/store/react/files' },
		{ name: 'scheduler', version: '0.26.0', source: 'store', node: 'npm:scheduler@0.26.0', location: '/store/scheduler/files' },
		{ name: '@beyond-js/kernel', version: KERNEL.version, source: 'installation', node: null, location: KERNEL.location }
	]);
	assert.equal(listed.filter(({ source }) => source === 'supplied').length, 0);
	assert.equal(listed.some(({ name }) => name === 'vue'), false, 'a library only a dropped adapter needed');
});

test('with an installed graph that provides the Kernel, nothing is read from the toolchain installation', async () => {
	const kernel = {
		...execution,
		nodes: new Map([...execution.nodes, ['npm:@beyond-js/kernel@0.1.12', { name: '@beyond-js/kernel', version: '0.1.12', location: '/store/kernel/files' }]]),
		find: name => (name === '@beyond-js/kernel' ? ['npm:@beyond-js/kernel@0.1.12'] : execution.find(name))
	};
	const runtime = { packages: ['@beyond-js/kernel', 'vue'], base: BASE };
	const composition = new Composition(declaration, { state: 'ready', diagnostics: [], execution: kernel }, { runtime });
	const listed = await new Provenance(workspace([{ name: 'app', version: '1.0.0', path: '/ws/app' }]), composition).list();

	assert.deepEqual(listed.filter(({ source }) => source === 'installation'), []);
	assert.deepEqual(listed.find(({ name }) => name === '@beyond-js/kernel'), {
		name: '@beyond-js/kernel', version: '0.1.12', source: 'store', node: 'npm:@beyond-js/kernel@0.1.12', location: '/store/kernel/files'
	});
});

test('a member the graph does not know yet, and a package without a manifest name, are described as such', async () => {
	const composition = new Composition(declaration, { state: 'stale', diagnostics: [], execution });
	const packages = [
		{ name: 'added', version: '0.1.0', path: '/ws/added' },
		{ name: undefined, version: undefined, path: '/ws/broken' }
	];
	const listed = await new Provenance(workspace(packages), composition).list();

	assert.deepEqual(listed.filter(({ source }) => source === 'workspace'), [
		{ name: 'added', version: '0.1.0', source: 'workspace', node: null, location: '/ws/added' }
	]);
});
