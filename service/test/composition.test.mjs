import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Composition } from '../host/composition.mjs';

/**
 * A declaration as `Declaration.read` gives it, with the members a case names
 */
const declaration = members => ({ kind: 'npm', members: members.map(([id, name, version]) => ({ id, name, version, path: `/ws/${id}`, manifest: {} })) });

/**
 * An execution projection of a graph that holds the given names, as `Execution.read` gives it
 */
const projection = (state, names = []) => {
	const execution = { find: name => (names.includes(name) ? [`npm:${name}@1.0.0`] : []) };
	return ['missing', 'incompatible'].includes(state) ? { state, diagnostics: [] } : { state, diagnostics: [], execution };
};

const SUPPLIED = [
	{ name: '@beyond-js/widgets', path: '/toolchain/widgets' },
	{ name: '@beyond-js/react-19-widgets', path: '/toolchain/react-19-widgets' }
];

test('every member of the declaration is given to the workspace by its id and its directory', () => {
	const composition = new Composition(declaration([['app', 'app', '1.0.0'], ['../message-v2', 'message', '2.0.0']]), projection('missing'));
	assert.deepEqual(composition.members, [
		{ id: 'app', path: '/ws/app' },
		{ id: '../message-v2', path: '/ws/../message-v2' }
	]);
	assert.deepEqual(composition.options.members, composition.members);
	assert.equal(composition.options.watcher, true);
});

test('without an installed graph the supplied packages are added, except a name a member provides', () => {
	const members = declaration([['app', 'app', '1.0.0'], ['widgets', '@beyond-js/widgets', '0.9.0']]);
	const composition = new Composition(members, projection('missing'), { supplied: SUPPLIED });

	assert.equal(composition.installed, false);
	assert.equal(composition.execution, undefined);
	assert.deepEqual(composition.supplied, [SUPPLIED[1]], 'the workspace wins a name, so both copies never meet');
	assert.deepEqual(composition.options.supplied, ['/toolchain/react-19-widgets']);
	assert.equal('execution' in composition.options, false);
});

test('a projection that is ready, stale or incomplete is served, and then nothing is supplied', () => {
	for (const state of ['ready', 'stale', 'incomplete']) {
		const read = projection(state, ['react']);
		const composition = new Composition(declaration([['app', 'app', '1.0.0']]), read, { supplied: SUPPLIED });

		assert.equal(composition.installed, true, state);
		assert.equal(composition.execution, read.execution, state);
		assert.equal(composition.options.execution, read.execution, state);
		assert.deepEqual(composition.supplied, [], `${state}: no supplied package conceals the graph`);
		assert.deepEqual(composition.options.supplied, []);
	}
});

test('a projection that is missing or incompatible is not served, and the workspace is composed as before', () => {
	for (const state of ['missing', 'incompatible']) {
		const composition = new Composition(declaration([['app', 'app', '1.0.0']]), projection(state), { supplied: SUPPLIED });
		assert.equal(composition.installed, false, state);
		assert.deepEqual(composition.supplied, SUPPLIED, state);
	}
});

test('the names the installed graph provides are known, and nothing is provided without one', () => {
	const installed = new Composition(declaration([['app', 'app', '1.0.0']]), projection('ready', ['react', 'app']));
	assert.equal(installed.provides('react'), true);
	assert.equal(installed.provides('app'), true);
	assert.equal(installed.provides('@beyond-js/kernel'), false);

	const none = new Composition(declaration([['app', 'app', '1.0.0']]), projection('missing'));
	assert.equal(none.provides('react'), false);
});

// The runtime the toolchain offers: its own (the Kernel) and the libraries its supplied adapters need
const RUNTIME = { packages: ['@beyond-js/kernel', 'react', 'react-dom', 'vue', 'svelte'], base: 'file:///toolchain/package.json' };

test('without an installed graph the runtime of the session is what the toolchain offers', () => {
	for (const state of ['missing', 'incompatible']) {
		const composition = new Composition(declaration([['app', 'app', '1.0.0']]), projection(state), { supplied: SUPPLIED, runtime: RUNTIME });
		assert.deepEqual(composition.runtime, RUNTIME, state);
	}
});

test('with an installed graph only the toolchain\'s own runtime is left, never the libraries of the dropped adapters (A13)', () => {
	for (const state of ['ready', 'stale', 'incomplete']) {
		// The graph provides React; Vue and Svelte are nowhere in it, and still are not resolved from the toolchain
		const composition = new Composition(declaration([['app', 'app', '1.0.0']]), projection(state, ['react']), { supplied: SUPPLIED, runtime: RUNTIME });
		assert.deepEqual(composition.runtime, { packages: ['@beyond-js/kernel'], base: RUNTIME.base }, state);
	}
});

test('a graph that provides the toolchain\'s own runtime leaves nothing to resolve from the toolchain', () => {
	const composition = new Composition(declaration([['app', 'app', '1.0.0']]), projection('ready', ['@beyond-js/kernel']), { runtime: RUNTIME });
	assert.deepEqual(composition.runtime, { packages: [], base: RUNTIME.base });
});

test('a toolchain that describes no runtime describes none in any mode', () => {
	assert.equal(new Composition(declaration([]), projection('missing')).runtime, undefined);
	assert.equal(new Composition(declaration([]), projection('ready')).runtime, undefined);
});
