import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { Graph } from '../host/graph.mjs';
import { Selection } from '../host/selection.mjs';

const NODE = { platform: 'node', environment: 'development' };
const UNDECLARED = { code: 'BUILD_FAILED', message: 'no conditional', diagnostics: [{ code: 'CONDITIONAL_NOT_FOUND', message: 'The module declares no "node" platform' }] };

const module = (name, version, subpath) => {
	const path = subpath === '.' ? '' : `/${subpath.slice(2)}`;
	return { specifier: `${name}${path}`, vspecifier: `${name}@${version}${path}`, name, version, subpath, path: `/ws/${name}` };
};

/**
 * A hosted workspace as the selection reads it: `@fixture/app/main` builds for Node and imports
 * `@fixture/lib/text`; `@fixture/widget/view` builds for browsers only; `@fixture/broken/main` fails for Node and
 * for browsers. With `versions`, a second version of the widget publishes the same specifier. Every build asked
 * for is recorded with its platform.
 */
const delivery = ({ versions = false, broken = false } = {}) => {
	const published = [
		module('@fixture/app', '1.0.0', './main'),
		module('@fixture/lib', '1.0.0', './text'),
		module('@fixture/widget', '1.0.0', './view'),
		...(versions ? [module('@fixture/widget', '2.0.0', './view')] : []),
		module('@fixture/broken', '1.0.0', './main')
	];
	const built = [];
	const failing = { code: 'BUILD_FAILED', message: 'syntax error', diagnostics: [{ code: 'SYNTAX', message: 'unexpected token' }] };

	return {
		built,
		published: async () => published,
		selection: {
			resolve: async selector => {
				const [name, version] = selector.startsWith('@fixture/widget@2') ? ['@fixture/widget', '2.0.0'] : [selector.split('/').slice(0, 2).join('/'), '1.0.0'];
				const found = published.find(one => one.name === name && one.version === version && selector.endsWith(one.subpath.slice(2)));
				if (!found) return { errors: [{ code: 'PACKAGE_NOT_FOUND', message: `Package "${name}" is not in the workspace` }] };
				return { selected: { package: { name, version }, subpath: found.subpath, specifier: found.specifier, vspecifier: found.vspecifier }, errors: [] };
			}
		},
		module: async ({ vspecifier }, { platform }) => {
			built.push([vspecifier, platform]);
			if (vspecifier.startsWith('@fixture/broken')) return { failure: failing };
			if (vspecifier.startsWith('@fixture/widget') && platform === 'node') return { failure: UNDECLARED };
			if (vspecifier.startsWith('@fixture/widget') && broken) return { failure: failing };
			const dependencies = vspecifier.startsWith('@fixture/app') ? [{ specifier: '@fixture/lib/text', source: 'workspace', vspecifier: '@fixture/lib@1.0.0/text' }] : [];
			return { delivered: { hash: 'h', dependencies } };
		}
	};
};

const selection = (hosted, previews = true) => new Selection(hosted, new Graph(hosted, NODE), { previews });

test('a module that builds for Node is checked for Node, as before', async () => {
	const hosted = delivery();
	const { status, body } = await selection(hosted).answer('@fixture/app/main', '/ws');

	assert.equal(status, 200);
	assert.deepEqual(body, {
		selected: { specifier: '@fixture/app/main', vspecifier: '@fixture/app@1.0.0/main', name: '@fixture/app', version: '1.0.0', subpath: './main' },
		modules: ['@fixture/app@1.0.0/main', '@fixture/lib@1.0.0/text'],
		failures: []
	});
	assert.ok(hosted.built.every(([, platform]) => platform === 'node'));
});

test('a module that builds for browsers only is answered with the address of its preview, checked for browsers', async () => {
	const hosted = delivery();
	const { status, body } = await selection(hosted).answer('@fixture/widget/view');

	assert.equal(status, 200);
	assert.equal(body.browser, true);
	assert.equal(body.preview, '/preview/?entry=%40fixture%2Fwidget%2Fview');
	assert.equal(body.selected.vspecifier, '@fixture/widget@1.0.0/view');
	assert.deepEqual(body.modules, ['@fixture/widget@1.0.0/view']);
	assert.deepEqual(body.failures, []);
	assert.deepEqual(hosted.built, [['@fixture/widget@1.0.0/view', 'node'], ['@fixture/widget@1.0.0/view', 'web']]);
});

test('without the development extension a browser module has no preview to give', async () => {
	const { status, body } = await selection(delivery(), false).answer('@fixture/widget/view');
	assert.equal(status, 200);
	assert.equal(body.browser, true);
	assert.equal(body.preview, null);
});

test('several local versions of one specifier are previewed by the versioned identity of the one selected', async () => {
	const { body } = await selection(delivery({ versions: true })).answer('@fixture/widget@2.0.0/view');
	assert.equal(body.selected.vspecifier, '@fixture/widget@2.0.0/view');
	assert.equal(body.preview, `/preview/?entry=${encodeURIComponent('@fixture/widget@2.0.0/view')}`);
});

test('a browser module whose graph fails for browsers is still a browser module, with its failures', async () => {
	const { body } = await selection(delivery({ broken: true })).answer('@fixture/widget/view');
	assert.equal(body.browser, true);
	assert.equal(body.failures.length, 1);
	assert.equal(body.failures[0].code, 'BUILD_FAILED');
	assert.equal(body.failures[0].diagnostics[0].code, 'SYNTAX');
});

test('a module that fails for another reason is a failure for Node, not a browser module', async () => {
	const { status, body } = await selection(delivery()).answer('@fixture/broken/main');
	assert.equal(status, 200);
	assert.equal('browser' in body, false);
	assert.equal(body.failures[0].diagnostics[0].code, 'SYNTAX');
});

test('a selector that names nothing is answered 404 with its diagnostics, through the route', async t => {
	const app = express();
	selection(delivery()).setup(app);
	const server = app.listen(0, '127.0.0.1');
	await new Promise(resolve => server.once('listening', resolve));
	t.after(() => {
		server.closeAllConnections();
		return new Promise(resolve => server.close(resolve));
	});
	const origin = `http://127.0.0.1:${server.address().port}`;

	const missing = await fetch(`${origin}/selection?${new URLSearchParams({ selector: '@fixture/absent/main' })}`);
	assert.equal(missing.status, 404);
	const { error } = await missing.json();
	assert.equal(error.code, 'PACKAGE_NOT_FOUND');
	assert.equal(error.diagnostics.length, 1);

	const found = await fetch(`${origin}/selection?${new URLSearchParams({ selector: '@fixture/widget/view' })}`);
	assert.equal(found.status, 200);
	assert.equal((await found.json()).preview, '/preview/?entry=%40fixture%2Fwidget%2Fview');
});
