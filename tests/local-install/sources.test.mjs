/**
 * Packages published as Beyond sources (`beyond-publication/1`, form `source`) and installed from a registry, served
 * through the installed graph of a workspace: each module is compiled by the bundler its package declares, from the
 * location of its node and with the identity of that node, as the preparation of a package for delivery compiles it
 * (`fixtures/sources`, read its README). A module of the packaging bundler is compiled from its TypeScript entry point,
 * one the ts bundler composes is composed on the runtime of the page, what a package of the store imports follows its
 * own edges, and a bundler that cannot compile here, a declaration that cannot be read or Beyond modules without the
 * source form are refused with the reason, never compiled by another compiler. The harness is `support/sources.mjs`.
 *
 * It needs `BEE_URL` and the loader of `BEE_NODE_DIR` (see `tests/stage-1/README.md`); no watcher is needed:
 *
 * ```sh
 * BEE_URL=http://localhost:1112,… node --import "$BEE_NODE_DIR/register.mjs" tests/local-install/sources.test.mjs
 * ```
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { utimes } from 'node:fs/promises';
import { join } from 'node:path';
import { Identity, ModulePath, Options, Resolution, ResourcePath } from '@beyond-js/artifact-api';
import { Sources, WEB, PRODUCTION, BOUND, codes } from './support/sources.mjs';

const QUERY = new Options({ ...Options.development, target: 'browser' }).query;
const VERSION = '1.0.0';

/**
 * The node of a release of the installed graph, with its key
 */
const located = (sources, name) => {
	const [key] = sources.execution.find(name, VERSION);
	return { key, node: sources.execution.node(key) };
};
const request = (sources, name, subpath, conditions = WEB) => sources.delivery.module({ name, version: VERSION, subpath }, conditions);

/**
 * The sources an inline source map names
 */
const mapped = code => {
	const [, encoded] = /sourceMappingURL=data:application\/json;(?:charset=utf-8;)?base64,([A-Za-z0-9+/=]+)/.exec(code) ?? [];
	return encoded ? JSON.parse(Buffer.from(encoded, 'base64').toString('utf8')).sources : [];
};

test('runtime: a module of the packaging bundler is compiled from its TypeScript entry point, its other public modules kept as references', BOUND, async t => {
	const sources = await Sources.install(t);
	const { node } = located(sources, '@sources/runtime');

	const bundle = await request(sources, '@sources/runtime', './bundle');
	assert.equal(bundle.failure, undefined, JSON.stringify(bundle.failure));
	const { delivered } = bundle;
	assert.deepEqual([delivered.key, delivered.vspecifier, delivered.dependencies], ['installed', '@sources/runtime@1.0.0/bundle', []]);
	// What was installed is TypeScript: only a compilation of it is a module a browser can load
	assert.match(delivered.code('none'), /sources runtime \$\{release\}, compiled from TypeScript/);
	assert.doesNotMatch(delivered.code('none'), /: string/);
	assert.ok(mapped(delivered.code('inline')).includes(join(node.location, 'bundle', 'index.ts')), 'its map names the source where the node is');

	// Another public module of the package references the bundle instead of carrying a copy of it
	const core = await request(sources, '@sources/runtime', './core');
	assert.deepEqual(core.delivered.dependencies, [{ specifier: '@sources/runtime/bundle', source: 'external' }]);
	assert.match(core.delivered.code('none'), /from "@sources\/runtime\/bundle"/);
	assert.doesNotMatch(core.delivered.code('none'), /compiled from TypeScript/);

	// The production output is the same compilation, minified
	const production = await request(sources, '@sources/runtime', './bundle', PRODUCTION);
	assert.equal(production.delivered.key, 'installed');
	assert.doesNotMatch(production.delivered.code('none'), /\/\/ index\.ts/);
	assert.match(production.delivered.code('none'), /compiled from TypeScript/);
});

test('library: a module its ts bundler composes is compiled by that bundler from the node, with its identity, on the runtime of the page', BOUND, async t => {
	const sources = await Sources.install(t);
	const { key, node } = located(sources, '@sources/lib');
	const tone = located(sources, 'tone');

	// The package is read where its node is, with the identity of the node, as the preparation reads a pinned package
	const installed = await sources.delivery.installed.module({ name: '@sources/lib', version: VERSION, subpath: './greeting' }, WEB);
	assert.equal(installed.failure, undefined, JSON.stringify(installed.failure));
	assert.deepEqual([installed.composed.path, installed.composed.identity], [node.location, JSON.stringify([key, node.integrity])]);

	const { delivered, failure } = await request(sources, '@sources/lib', './greeting');
	assert.equal(failure, undefined, JSON.stringify(failure));
	assert.deepEqual([delivered.key, delivered.vspecifier, delivered.runtime], ['web', '@sources/lib@1.0.0/greeting', '@sources/runtime/bundle']);
	// The Kernel identity its sources import is the core of the runtime its bundler names; its own dependency is its node
	assert.deepEqual(delivered.dependencies, [
		{ specifier: '@sources/runtime/core', source: 'runtime' },
		{ specifier: 'tone', source: 'external', node: tone.key, version: VERSION, location: tone.node.location }
	]);
	assert.match(delivered.code('none'), /from '@sources\/runtime\/core'/);
	assert.match(delivered.code('none'), /new __Bundle\(\{"module":\{"vspecifier":"@sources\/lib@1\.0\.0\/greeting"\}/);
	assert.equal(typeof delivered.patch(), 'string', 'a development composition carries the update of its internal modules');

	// Its stylesheet is the one its processors build
	const styles = await sources.delivery.resources.styles({ name: '@sources/lib', version: VERSION, subpath: './greeting' }, WEB);
	assert.equal(styles.key, 'web');
	assert.match(styles.styles.code(), /\.greeting \{\s*color: rgb\(37, 99, 235\);/);

	// Production output is its production conditional: minified, without a map or an update
	const production = await request(sources, '@sources/lib', './greeting', PRODUCTION);
	assert.equal(production.delivered.key, 'web/production');
	assert.doesNotMatch(production.delivered.code('inline'), /sourceMappingURL/);
	assert.equal(production.delivered.patch(), undefined);

	// A node whose manifest was written anew is opened again, with the same identity
	await utimes(join(node.location, 'package.json'), new Date(), new Date(Date.now() + 60_000));
	const reopened = await sources.delivery.installed.module({ name: '@sources/lib', version: VERSION, subpath: './greeting' }, WEB);
	assert.notEqual(reopened.composed, installed.composed);
	assert.equal(reopened.composed.identity, installed.composed.identity);
});

test('edges: what a package of the store imports follows its own edges, and what only the application declares is not installed for it', BOUND, async t => {
	const sources = await Sources.install(t);
	const lib = located(sources, '@sources/lib');

	const loose = await request(sources, '@sources/lib', './loose');
	assert.equal(loose.failure.code, 'BUILD_FAILED');
	assert.deepEqual(codes(loose.failure.diagnostics), ['DEPENDENCY_NOT_INSTALLED']);
	assert.match(loose.failure.message, /imports extra, which its graph does not provide/);

	// The page reaches the library by the application's edge, an external dependency of the exact node
	const { delivered } = await request(sources, '@sources/app', './main');
	assert.deepEqual(delivered.dependencies, [{ specifier: '@sources/lib/greeting', source: 'external', node: lib.key, version: VERSION, location: lib.node.location }]);
});

test('resolution: the document maps the composed modules of the store, the runtime they share and what they import, under the registry of their nodes', BOUND, async t => {
	const sources = await (await Sources.install(t)).serve();
	const response = await sources.get('/resolution.json?target=browser&format=esm');
	assert.equal(response.status, 200, await response.clone().text());
	const resolution = Resolution.parse(await response.text());

	const { node } = located(sources, '@sources/lib');
	const registry = node.origin.provider;
	const module = (name, subpath) => `${ModulePath.format(new Identity({ registry, name, version: VERSION, subpath }))}?${QUERY}`;
	const style = (name, subpath) => `${ResourcePath.format({ kind: 'style', identity: new Identity({ registry, name, version: VERSION, subpath }) })}?${QUERY}`;
	assert.deepEqual(Object.fromEntries(resolution.imports), {
		'@sources/app/main': `${ModulePath.format(new Identity({ name: '@sources/app', version: VERSION, subpath: './main' }))}?${QUERY}`,
		'@sources/lib/greeting': module('@sources/lib', './greeting'),
		'@sources/lib/greeting.css': style('@sources/lib', './greeting'),
		'@sources/runtime/bundle': module('@sources/runtime', './bundle'),
		'@sources/runtime/core': module('@sources/runtime', './core'),
		tone: module('tone', '.')
	});

	// Every address is a module or a stylesheet this service delivers from the store
	for (const [specifier, url] of resolution.imports) assert.equal((await sources.get(url)).status, 200, `${specifier}: ${url}`);
	assert.match(await (await sources.get(module('@sources/runtime', './bundle'))).text(), /compiled from TypeScript/);
});

test('refusals: a bundler that cannot compile here, a declaration that cannot be read and Beyond modules without the source form are never compiled by another compiler', BOUND, async t => {
	const sources = await Sources.install(t);
	const expectations = [
		['@sources/refused', ['PLUGIN_REFUSED', 'INVALID_BUNDLER'], 'its bundler is a program of its own, which the toolchain does not ship'],
		['@sources/unregistered', ['BUNDLER_NOT_FOUND'], 'its bundlers do not register the one its module selects'],
		['@sources/unreadable', ['PUBLICATION_PROTOCOL_UNKNOWN'], 'a declaration that cannot be read selects no form'],
		['@sources/undeclared', ['OUTPUT_NOT_AVAILABLE', 'PUBLICATION_UNDECLARED'], 'an ordinary npm package, which says why it is one']
	];
	for (const [name, expected, why] of expectations) {
		const { delivered, failure } = await request(sources, name, './main');
		assert.equal(delivered, undefined, `${name}: ${why}`);
		assert.deepEqual([failure.code, codes(failure.diagnostics)], ['BUILD_FAILED', expected], `${name}: ${why}`);
	}
	assert.equal(globalThis.sourcesRefusedRan, undefined, 'no code a package of the store names runs here');
});
