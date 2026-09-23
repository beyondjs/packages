/**
 * The real `react`, `react-dom` and `scheduler` packages, taken from a directory of installed packages that
 * already exists on this machine: nothing is downloaded. `CDN_REACT_MODULES` names that `node_modules`
 * directory; otherwise the one the Beyond ESBuild checkout prepares for its own ecosystem checks is used
 * when `BEYOND_ESBUILD` is set. Without either, the steps are skipped and say so.
 */
import assert from 'node:assert/strict';
import { cp, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Store, Prepared, Consumer } from './harness.mjs';
import { SystemLoader } from './system.mjs';
import { Reproducible } from './reproducible.mjs';
import { Keyed } from '@beyond-js/packages/analysis';

const NAMES = ['react', 'react-dom', 'scheduler'];
const ENTRIES = ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', 'react-dom/server'];

export class RealReact {
	#report;
	#compiler;
	#scratch;

	constructor(report, compiler, scratch) {
		this.#report = report;
		this.#compiler = compiler;
		this.#scratch = scratch;
	}

	get #installed() {
		const { CDN_REACT_MODULES, BEYOND_ESBUILD } = process.env;
		const candidates = [CDN_REACT_MODULES, BEYOND_ESBUILD && join(BEYOND_ESBUILD, 'beyond/.cache/ecosystem/node_modules')];
		return candidates.find(directory => directory && NAMES.every(name => existsSync(join(directory, name, 'package.json'))));
	}

	/**
	 * A store that holds copies of the installed packages, pinned by a graph in which the renderer reaches
	 * the library through its peer edge
	 */
	async #store(installed) {
		const store = await new Store().create();
		const keys = {};
		for (const name of NAMES) {
			const { version } = JSON.parse(await readFile(join(installed, name, 'package.json'), 'utf8'));
			keys[name] = `npm:${name}@${version}`;
			await cp(join(installed, name), await store.add(keys[name], name, version, name), { recursive: true, dereference: true });
		}
		const graph = store.graph;
		graph.edges.push(Store.edge(keys['react-dom'], keys.react, 'peer', 'npm:@fixture/app@1.0.0'), Store.edge(keys['react-dom'], keys.scheduler));
		return { store, graph: Store.seal(graph), keys };
	}

	async run() {
		const installed = this.#installed;
		if (!installed) return this.#report.skip('react: the real packages', 'no installed react, react-dom and scheduler found; set CDN_REACT_MODULES');

		const { store, graph, keys } = await this.#store(installed);
		const prepare = (conditions, format) => Prepared.of({ graph, sources: store.sources }, this.#compiler, ENTRIES, conditions, format);
		try {
			await this.#report.step('react: react, react/jsx-runtime, react-dom, react-dom/client and react-dom/server are separate units that share one React', async () => {
				const prepared = await prepare({ platform: 'node', environment: 'production' }, 'esm');
				assert.deepEqual(prepared.diagnostics, []);
				assert.deepEqual(prepared.inventory.diagnostics, []);
				const modules = prepared.inventory.items.filter(({ kind }) => kind === 'module').map(item => Keyed.specifier(item, prepared.graph)).sort();
				assert.deepEqual(modules, [...ENTRIES, 'scheduler'].sort());

				for (const specifier of ['react-dom', 'react-dom/client', 'react-dom/server']) {
					const code = prepared.code.get(specifier);
					assert.match(code, /from\s*"react"/, `${specifier} imports the public module "react"`);
					assert.ok(!/__require\(["']/.test(code), `${specifier} has no dynamic require`);
				}
				const renderer = prepared.units.get(`module:${keys['react-dom']}/client`).outputs[0].relations.references;
				assert.deepEqual(renderer.filter(({ builtin }) => !builtin).map(({ specifier, package: pkg }) => `${specifier} → ${pkg}`), [
					`react → ${keys.react}`, `react-dom → ${keys['react-dom']}`, `scheduler → ${keys.scheduler}`
				]);

				const result = await Consumer.run('react', await prepared.write(join(this.#scratch, 'react')), this.#scratch);
				assert.match(result.html, /^<p id="[^"]+">shared:42<\/p>$/, 'Hooks run in the renderer: it uses the React the component imported');
				assert.deepEqual([result.root, result.named, result.defaulted], ['function', 'function', true]);
				assert.equal(result.version, result.dom);
				const bytes = [...prepared.code.values()].reduce((total, code) => total + Buffer.byteLength(code), 0);
				return `react ${result.version}, ${prepared.code.size} units, ${bytes} bytes of production code, renderToString → ${result.html}`;
			});

			await this.#report.step('react: development and browser units select their exports conditions and NODE_ENV branch', async () => {
				const development = await prepare({ platform: 'node', environment: 'development' }, 'esm');
				assert.deepEqual(development.diagnostics, []);
				assert.ok(development.code.get('react').includes('react.development.js') && !development.code.get('react').includes('react.production.js'));
				const result = await Consumer.run('react', await development.write(join(this.#scratch, 'react-development')), this.#scratch);
				assert.match(result.html, /shared:42/);

				const browser = await prepare({ platform: 'browser', environment: 'production' }, 'esm');
				assert.deepEqual(browser.diagnostics, []);
				assert.ok(browser.code.get('react-dom/server').includes('react-dom-server.browser.production.js'), 'The browser condition selects the browser server build');
				assert.ok(![...browser.units.values()].some(({ outputs }) => outputs.some(({ relations }) => relations.references?.some(({ builtin }) => builtin))), 'No Node builtin is referenced for a browser');
				return 'development executed; browser/production references no Node builtin';
			});

			await this.#report.step('react: the System.register units render through a minimal loader with one shared React', async () => {
				const system = await prepare({ platform: 'node', environment: 'production' }, 'system');
				assert.deepEqual(system.diagnostics, []);
				const loader = new SystemLoader(system.code);
				const React = await loader.import('react');
				const { jsx } = await loader.import('react/jsx-runtime');
				const server = await loader.import('react-dom/server');
				const App = () => jsx('b', { children: `count:${React.useState(7)[0]}` });
				assert.equal(server.renderToString(jsx(App, {})), '<b>count:7</b>');
				assert.equal(loader.evaluations.get('react'), 1);
				return `<b>count:7</b>; "react" evaluated ${loader.evaluations.get('react')} time`;
			});
			const placed = { root: store.root, graph, sources: store.sources };
			await new Reproducible(this.#report, this.#compiler).check('the real React packages', placed, ENTRIES);
		} finally {
			await store.destroy();
		}
	}
}
