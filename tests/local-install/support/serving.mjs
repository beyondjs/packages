/**
 * The harness of `serving.test.mjs` and `serving.walk.test.mjs`: one served copy of `fixtures/serving` per case. The
 * fixture is copied into a unique temporary directory (its `root/`, `outside/` and `store/`), its hand-written
 * projection is read with the directories of the copy and reduced to the members the case names, and the workspace
 * built from those members and that projection is served by the compiled-module routes and the development extension
 * on one application on an allocated port, as the development service mounts them. It never writes the fixtures.
 *
 * Two parts are generated, because their size is what a case tests: the lattice of store packages under the member
 * `app-l` (`lattice` layers of two packages, each importing both packages of the next layer, so the paths to the
 * bottom double with every layer), and how many modules the routes and the preview ask the delivery for (`count`).
 */
import { cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { Options } from '@beyond-js/artifact-api';
import { Workspace } from '@beyond-js/packages/workspace';
import { Delivery } from '@beyond-js/packages/artifacts';
import { Execution } from '@beyond-js/packages/execution';
import { Origins, Routes, Sources } from '@beyond-js/packages/http/routes';

const { Development } = await import('@beyond-js/packages/development');

const FIXTURE = fileURLToPath(new URL('../fixtures/serving/', import.meta.url));

/**
 * The query of a development module for browsers, which every address of the documents carries
 */
export const QUERY = new Options({ ...Options.development, target: 'browser' }).query;

/**
 * The registry id Packages' resolution gives `https://packages.example.test/npm`, the provider of `toolkit` in the
 * projection
 */
export const REGISTRY = await new Origins().registry('https://packages.example.test/npm');

/**
 * The origin-relative address of a module: `/m/<package>@<version>/modules/<subpath>?<development query>`
 */
export const module = (path, subpath = '~root') => `${path}/modules/${subpath}?${QUERY}`;

/**
 * The imports or scopes of a resolution as plain objects
 */
export const table = map => Object.fromEntries([...map].map(([key, value]) => [key, value instanceof Map ? table(value) : value]));

/**
 * The distinct codes of a list of diagnostics
 */
export const codes = diagnostics => [...new Set((diagnostics ?? []).map(({ code }) => code))];

/**
 * One served copy of `fixtures/serving`
 */
export class Served {
	/**
	 * Every member of the fixture but the ones of the runtime and peer cases
	 */
	static ALL = ['message-v1', '../outside/message-v2', 'app-a', 'app-b', 'both'];

	/**
	 * How long a request may take before it fails the test instead of hanging it
	 */
	static BOUND = 120000;

	#base;
	#root;
	#server;
	#workspace;
	#development;
	#compiled = 0;

	/**
	 * The root of the copy of the workspace
	 */
	get root() {
		return this.#root;
	}

	get origin() {
		return `http://127.0.0.1:${this.#server.address().port}`;
	}

	/**
	 * Serves a copy of the fixture, stopped and removed when the test ends
	 *
	 * @param ids The members the workspace is built with, in this order
	 * @param options `projected`: whether the workspace is served from the projection of its installed graph (default
	 * true); `unlisted`: members of the workspace the projection leaves out, as if they were declared after it was
	 * installed; `lattice`: the layers of the lattice under `app-l`
	 */
	static async start(t, ids = Served.ALL, { projected = true, unlisted = [], lattice = 0 } = {}) {
		const served = new Served();
		t.after(() => served.stop());
		await served.#start(ids, projected, unlisted, lattice);
		return served;
	}

	/**
	 * How many modules the routes and the preview asked the delivery for since the last count
	 */
	count() {
		const compiled = this.#compiled;
		this.#compiled = 0;
		return compiled;
	}

	async #start(ids, projected, unlisted, lattice) {
		this.#base = await realpath(await mkdtemp(join(tmpdir(), 'beyond-serving-')));
		for (const part of ['root', 'outside', 'store']) await cp(join(FIXTURE, part), join(this.#base, part), { recursive: true });
		const [root, outside, store] = ['root', 'outside', 'store'].map(part => join(this.#base, part));
		this.#root = root;

		const escape = path => JSON.stringify(path).slice(1, -1);
		const text = (await readFile(join(FIXTURE, 'execution.json'), 'utf8'))
			.replaceAll('${ROOT}', escape(root))
			.replaceAll('${OUTSIDE}', escape(outside))
			.replaceAll('${STORE}', escape(store));
		const document = await Served.#lattice(JSON.parse(text), store, lattice);
		const listed = ids.filter(id => !unlisted.includes(id));
		const execution = projected ? { execution: Execution.from(Served.#project(document, listed), root) } : {};
		const directory = id => (id.startsWith('../outside/') ? join(outside, id.slice('../outside/'.length)) : join(root, id));
		this.#workspace = new Workspace(root, { members: ids.map(id => ({ id, path: directory(id) })), ...execution });
		const delivery = this.#counted(new Delivery(this.#workspace));

		const app = express();
		Routes.setup(app, delivery);
		this.#development = new Development({ delivery: Served.#facade(delivery), settings: { root } });
		await this.#development.setup(app);
		Routes.errors(app);
		this.#server = await new Promise((resolve, reject) => {
			const server = app.listen(0, '127.0.0.1', () => resolve(server)).once('error', reject);
		});
	}

	/**
	 * A delivery whose module requests are counted
	 */
	#counted(delivery) {
		return new Proxy(delivery, {
			get: (target, property) => {
				if (property === 'module') return (...request) => (this.#compiled++, target.module(...request));
				const value = target[property];
				return typeof value === 'function' ? value.bind(target) : value;
			}
		});
	}

	/**
	 * Adds the generated lattice to the store of the copy and to the projection: `d<layer>a` and `d<layer>b`, each
	 * importing both packages of the next layer, the first layer imported by `app-l`
	 */
	static async #lattice(document, store, layers) {
		const node = name => `npm:${name}@1.0.0`;
		for (let layer = 0; layer < layers; layer++) {
			for (const side of ['a', 'b']) {
				const name = `d${layer}${side}`;
				const next = layer === layers - 1 ? [] : [`d${layer + 1}a`, `d${layer + 1}b`];
				const code = next.length ? `import { a as x } from '${next[0]}';\nimport { b as y } from '${next[1]}';\nexport const ${side} = '${name}' + x + y;\n` : `export const ${side} = '${name}';\n`;
				const location = join(store, 'public', 'npm', name, '1.0.0', 'sha512-lattice', 'files');
				await mkdir(location, { recursive: true });
				await writeFile(join(location, 'package.json'), JSON.stringify({ name, version: '1.0.0', type: 'module', exports: './index.js' }));
				await writeFile(join(location, 'index.js'), code);
				const origin = { provider: 'npm', registry: 'https://registry.npmjs.org/' };
				document.nodes[node(name)] = { name, version: '1.0.0', origin, visibility: 'public', integrity: 'sha512-lattice', tarball: null, location };
				next.forEach(one => document.edges.push({ from: node(name), to: node(one), kind: 'dependency', range: '1.0.0' }));
			}
		}
		layers && ['d0a', 'd0b'].forEach(one => document.edges.push({ from: 'workspace:app-l', to: node(one), kind: 'dependency', range: '1.0.0' }));
		return document;
	}

	/**
	 * The projection of a workspace of the given members: the fixture's, without the other members, their nodes and
	 * the edges that name them, as installing those members alone would write it
	 */
	static #project(document, ids) {
		const dropped = new Set(Object.keys(document.members).filter(id => !ids.includes(id)).map(id => `workspace:${id}`));
		const kept = (entries, key) => Object.fromEntries(Object.entries(entries).filter(entry => !dropped.has(key(entry))));
		document.members = kept(document.members, ([, { node }]) => node);
		document.inputs.members = kept(document.inputs.members, ([id]) => `workspace:${id}`);
		document.nodes = kept(document.nodes, ([key]) => key);
		document.edges = document.edges.filter(({ from, to, context }) => ![from, to, context].some(key => dropped.has(key)));
		return document;
	}

	/**
	 * What a host gives its extensions over a delivery, as the development service does
	 */
	static #facade(delivery) {
		const sources = new Sources(delivery);
		return {
			execution: delivery.execution,
			published: () => delivery.published(),
			module: (request, conditions) => delivery.module(request, conditions),
			supplies: (name, version) => delivery.supplies(name, version),
			origin: (name, version) => sources.origin(name, version),
			registry: base => sources.origins.registry(base)
		};
	}

	/**
	 * A bounded request of this service: one that never settles fails the test instead of hanging it
	 */
	get(path, init = {}) {
		return fetch(new URL(path, this.origin), { ...init, signal: AbortSignal.timeout(Served.BOUND) });
	}

	/**
	 * A request answered with JSON: its status and its body
	 */
	async json(path, init) {
		const response = await this.get(path, init);
		return { status: response.status, body: await response.json() };
	}

	/**
	 * The preview description of an entry (`/preview/entry.json`)
	 */
	preview(entry) {
		return this.json(`/preview/entry.json?entry=${encodeURIComponent(entry)}`);
	}

	async stop() {
		this.#development?.stop();
		this.#server?.closeAllConnections();
		await new Promise(resolve => (this.#server ? this.#server.close(resolve) : resolve()));
		this.#workspace?.destroy();
		this.#base && (await rm(this.#base, { recursive: true, force: true }));
	}
}
