/**
 * The fixture of the CDN analysis and output validations: a store of extracted packages and the pinned graph
 * that joins them, built in a temporary directory without any network access.
 *
 * - `@fixture/app` (Beyond sources): the application. `./main` is its entry; `./admin` is never reached.
 * - `@fixture/ui` (Beyond sources): `./widget` (eager, with a stylesheet, a declared logo and a font),
 *   `./chart` (reached only through a dynamic import), `./theme` (a style public module), `./extra` (only
 *   reachable through a declaration) and `./unused` (never reached).
 * - `fake-react`, `fake-react-dom`: ordinary CommonJS npm packages shaped like React and its renderer:
 *   `exports` conditions, `process.env.NODE_ENV` branches, and a peer that must stay one shared module.
 */
import { mkdtemp, mkdir, writeFile, rm, realpath, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const publication = { protocol: 'beyond-publication/1', form: 'source' };

const app = {
	'package.json': JSON.stringify({
		name: '@fixture/app', version: '1.0.0',
		exports: { './main': './main/index.ts', './admin': './admin/index.ts' },
		dependencies: { '@fixture/ui': '^2.0.0', 'fake-react': '^18.0.0', 'fake-react-dom': '^18.0.0' },
		beyond: { modules: { path: '.' }, publication }
	}),
	'main/index.ts': [
		`import { Widget } from '@fixture/ui/widget';`,
		`import '@fixture/ui/theme';`,
		`import { createElement, useState } from 'fake-react';`,
		`import { render } from 'fake-react-dom';`,
		`export const marker: string = 'APP_MAIN_SOURCE_MARKER';`,
		`export const chart = () => import('@fixture/ui/chart');`,
		`export const plugin = (name: string) => import('@fixture/plugins/' + name);`,
		`export const view = () => render(createElement(() => useState(Widget.label)));`,
		''
	].join('\n'),
	'admin/index.ts': `export const admin = 'never reached';\n`
};

const ui = {
	'package.json': JSON.stringify({
		name: '@fixture/ui', version: '2.0.0',
		exports: {
			'./widget': './widget/index.ts', './chart': './chart/index.ts', './theme': './theme/index.css',
			'./extra': './extra/index.ts', './unused': './unused/index.ts'
		},
		beyond: { modules: { path: '.' }, publication }
	}),
	'widget/module.json': JSON.stringify({ assets: ['logo.svg', 'fonts/fixture.woff2'] }),
	'widget/index.ts': [
		`import './widget.css';`,
		`import { label } from './label';`,
		`export const Widget = { label, source: 'WIDGET_SOURCE_MARKER' };`,
		''
	].join('\n'),
	'widget/label.ts': `export const label: string = 'widget';\n`,
	'widget/widget.css': [
		`.widget { background: url(./logo.svg); }`,
		`@font-face { font-family: Fixture; src: url("./fonts/fixture.woff2") format("woff2"); }`,
		''
	].join('\n'),
	'widget/logo.svg': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><rect width="1" height="1"/></svg>\n`,
	'widget/fonts/fixture.woff2': Buffer.from('wOF2-fixture-font-bytes'),
	'chart/index.ts': `import { Widget } from '@fixture/ui/widget';\nexport const chart = () => 'chart of ' + Widget.label;\n`,
	'theme/index.css': `:root { --fixture-accent: #d9684a; }\n`,
	'extra/index.ts': `export const extra = 'declared';\n`,
	'unused/index.ts': `export const unused = 'never reached';\n`
};

const react = {
	'package.json': JSON.stringify({
		name: 'fake-react', version: '18.0.0', main: 'index.js',
		exports: {
			'.': { 'react-server': './server.js', default: './index.js' },
			'./jsx-runtime': { browser: './jsx-runtime.browser.js', default: './jsx-runtime.js' },
			'./package.json': './package.json'
		}
	}),
	'index.js': [
		`'use strict';`,
		`if (process.env.NODE_ENV === 'production') {`,
		`  module.exports = require('./cjs/react.production.js');`,
		`} else {`,
		`  module.exports = require('./cjs/react.development.js');`,
		`}`,
		''
	].join('\n'),
	'server.js': `throw new Error('The react-server condition must not be selected');\n`,
	'jsx-runtime.js': `'use strict';\nvar React = require('fake-react');\nexports.jsx = function (type, props) { return React.createElement(type, props); };\nexports.runtime = 'default';\n`,
	'jsx-runtime.browser.js': `'use strict';\nvar React = require('fake-react');\nexports.jsx = function (type, props) { return React.createElement(type, props); };\nexports.runtime = 'browser';\n`
};
for (const mode of ['development', 'production']) {
	react[`cjs/react.${mode}.js`] = [
		`'use strict';`,
		`var internals = { dispatcher: null };`,
		`exports.__internals = internals;`,
		`exports.mode = '${mode}';`,
		`exports.version = '18.0.0';`,
		`exports.createElement = function (type, props) { return { type: type, props: props || {} }; };`,
		`exports.useState = function (initial) {`,
		`  if (!internals.dispatcher) throw new Error('Invalid hook call: the renderer uses another copy of fake-react');`,
		`  return internals.dispatcher.useState(initial);`,
		`};`,
		''
	].join('\n');
}

const renderer = {
	'package.json': JSON.stringify({
		name: 'fake-react-dom', version: '18.0.0', main: 'index.js',
		exports: { '.': './index.js', './client': './client.js', './package.json': './package.json' },
		peerDependencies: { 'fake-react': '^18.0.0' }
	}),
	'index.js': [
		`'use strict';`,
		`var React = require('fake-react');`,
		`exports.react = React;`,
		`exports.render = function (element) {`,
		`  React.__internals.dispatcher = { useState: function (initial) { return 'state:' + initial; } };`,
		`  try { return element.type(element.props); } finally { React.__internals.dispatcher = null; }`,
		`};`,
		''
	].join('\n'),
	'client.js': `'use strict';\nvar ReactDOM = require('fake-react-dom');\nexports.createRoot = function () { return { render: ReactDOM.render }; };\nexports.dom = ReactDOM;\n`
};

/**
 * The store of extracted packages and its graph
 */
export class Store {
	#root;
	get root() {
		return this.#root;
	}

	#packages = new Map();

	/**
	 * The `sources` input of analysis and generation: node key → extracted package root
	 */
	get sources() {
		return Object.fromEntries([...this.#packages].map(([key, { directory }]) => [key, join(this.#root, directory)]));
	}

	/**
	 * A node of the graph as the contract defines it, with an integrity derived from its identity
	 */
	static node(name, version) {
		const integrity = `sha512-${createHash('sha512').update(`${name}@${version}`).digest('base64')}`;
		const tarball = `https://registry.npmjs.org/${name}/-/${name.split('/').pop()}-${version}.tgz`;
		return { name, version, origin: { provider: 'npm', registry: 'https://registry.npmjs.org/' }, integrity, tarball, visibility: 'public' };
	}

	/**
	 * An edge of the graph. A peer edge names the node in whose context it was resolved.
	 */
	static edge(from, to, kind = 'dependency', context) {
		return Object.assign({ from, to, kind, range: '*' }, kind === 'peer' ? { context } : {});
	}

	/**
	 * Sets the digest of a graph to the one of its canonical form, after a check changed it
	 */
	static seal(graph) {
		const canonical = value => {
			if (value instanceof Array) return `[${value.map(canonical).join(',')}]`;
			if (value === null || typeof value !== 'object') return JSON.stringify(value);
			return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
		};
		const { digest, ...document } = graph;
		graph.digest = `sha256-${createHash('sha256').update(canonical(document)).digest('hex')}`;
		return graph;
	}

	/**
	 * The `beyond-graph/1` input, valid against the graph contract. The renderer reaches the library through
	 * a peer edge resolved in the context of the application.
	 */
	get graph() {
		const APP = 'npm:@fixture/app@1.0.0';
		const nodes = Object.fromEntries([...this.#packages].map(([key, { name, version }]) => [key, Store.node(name, version)]));
		const edges = [
			Store.edge(APP, 'npm:@fixture/ui@2.0.0'),
			Store.edge(APP, 'npm:fake-react@18.0.0'),
			Store.edge(APP, 'npm:fake-react-dom@18.0.0'),
			Store.edge('npm:fake-react-dom@18.0.0', 'npm:fake-react@18.0.0', 'peer', APP)
		].filter(({ from, to }) => nodes[from] && nodes[to]);
		const roots = [{ name: '@fixture/app', range: '1.0.0', node: APP, targets: ['web'] }];
		return Store.seal({ protocol: 'beyond-graph/1', roots, nodes, edges, overrides: [], lock: { reused: false }, exceptions: [], diagnostics: [] });
	}

	async create() {
		this.#root = await realpath(await mkdtemp(join(tmpdir(), 'beyond-cdn-store-')));
		await this.add('npm:@fixture/app@1.0.0', '@fixture/app', '1.0.0', 'app', app);
		await this.add('npm:@fixture/ui@2.0.0', '@fixture/ui', '2.0.0', 'ui', ui);
		await this.add('npm:fake-react@18.0.0', 'fake-react', '18.0.0', 'fake-react', react);
		await this.add('npm:fake-react-dom@18.0.0', 'fake-react-dom', '18.0.0', 'fake-react-dom', renderer);
		return this;
	}

	/**
	 * Adds a package to the store, or replaces the directory of a node
	 *
	 * @param files Its files by relative path; omitted when the directory is filled by the caller
	 */
	async add(key, name, version, directory, files = {}) {
		this.#packages.set(key, { name, version, directory });
		for (const [file, content] of Object.entries(files)) await this.write(directory, file, content);
		return join(this.#root, directory);
	}

	async write(directory, file, content) {
		const target = join(this.#root, directory, file);
		await mkdir(dirname(target), { recursive: true });
		await writeFile(target, content);
	}

	file(...parts) {
		return join(this.#root, ...parts);
	}

	/**
	 * Every file of the store, which is how a check shows that an operation wrote nothing
	 */
	async listing() {
		const entries = await readdir(this.#root, { recursive: true, withFileTypes: true });
		return entries.filter(entry => entry.isFile()).map(entry => join(entry.parentPath, entry.name)).sort();
	}

	destroy() {
		return rm(this.#root, { recursive: true, force: true });
	}
}

/**
 * The compiler the validations select: the Beyond fork when `BEYOND_ESBUILD` names its checkout and it was
 * laid out as a package, otherwise the `esbuild` this repository has installed, selected by name. Either
 * way the selection is explicit, and every inventory and output reports which one ran.
 */
export class Selected {
	static get compiler() {
		const { BEYOND_ESBUILD } = process.env;
		const fork = BEYOND_ESBUILD && join(BEYOND_ESBUILD, 'beyond/.cache/npm/node_modules/esbuild/lib/main.js');
		return fork && existsSync(fork) ? pathToFileURL(fork).href : 'esbuild';
	}
}
