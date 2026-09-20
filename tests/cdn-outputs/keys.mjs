/**
 * The compatibility key: what changes it, and what does not
 */
import assert from 'node:assert/strict';
import { cp, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Analysis } from '@beyond-js/packages/analysis';
import { Generation, Compatibility } from '@beyond-js/packages/generation';
import { Store } from './harness.mjs';

const MAIN = 'module:npm:@fixture/app@1.0.0/main';
const WIDGET = 'module:npm:@fixture/ui@2.0.0/widget';

export class Keys {
	#report;
	#store;
	#compiler;

	constructor(report, store, compiler) {
		this.#report = report;
		this.#store = store;
		this.#compiler = compiler;
	}

	/**
	 * The keys an inventory gives the code of the two modules, which exist before anything is generated
	 */
	async #keys({ graph = this.#store.graph, sources = this.#store.sources, conditions = { platform: 'browser', environment: 'development' }, format = 'esm', compiler = this.#compiler } = {}) {
		const { inventory, compiler: identity } = await Analysis.measured({ graph, sources, entries: ['@fixture/app/main'], conditions, compiler, format });
		const key = id => inventory.items.find(item => item.id === id).key;
		return { inventory, identity, conditions, main: key(MAIN), widget: key(WIDGET) };
	}

	async run() {
		const store = this.#store;
		let base;

		await this.#report.step('key: the key of an inventory item is the key of the output generated for it, and is not its digest', async () => {
			base = await this.#keys();
			const { graph, sources } = store;
			const item = base.inventory.items.find(({ id }) => id === WIDGET);
			const generated = await Generation.unit({ item, graph, sources, conditions: base.conditions, format: 'esm', compiler: this.#compiler });
			const js = generated.outputs.find(({ kind }) => kind === 'js');
			assert.equal(js.key, base.widget);
			assert.equal(generated.provenance.key, base.widget);
			assert.notEqual(js.key, js.digest);
			const style = base.inventory.items.find(({ id }) => id === WIDGET.replace('module:', 'style:'));
			assert.equal(generated.outputs.find(({ kind }) => kind === 'css').key, style.key, 'The stylesheet is produced under the key of its own item');
			assert.deepEqual(generated.outputs.filter(({ kind }) => kind === 'map').map(({ key }) => key), [js.key, style.key], 'A map carries the key of what it describes');
			return `./widget js ${base.widget.slice(0, 16)}…`;
		});

		await this.#report.step('key: compiler version, configuration, target, format and resolution change it', async () => {
			const changed = {
				configuration: await this.#keys({ conditions: { platform: 'browser', environment: 'production' } }),
				target: await this.#keys({ conditions: { platform: 'node', environment: 'development' } }),
				format: await this.#keys({ format: 'system' })
			};
			for (const [what, keys] of Object.entries(changed)) {
				assert.notEqual(keys.main, base.main, `${what} changes the key of ./main`);
				assert.notEqual(keys.widget, base.widget, `${what} changes the key of ./widget`);
			}

			// The same sources compiled by another compiler version are not compatible outputs
			const other = this.#compiler === 'esbuild' ? void 0 : 'esbuild';
			const version = other && (await this.#keys({ compiler: other }));
			if (version) {
				assert.notEqual(version.identity.version, base.identity.version);
				assert.notEqual(version.widget, base.widget);
			}
			const { inputs } = base.inventory.items.find(({ id }) => id === WIDGET);
			const synthetic = version => Compatibility.key(Object.assign({}, inputs, { compiler: Object.assign({}, inputs.compiler, { version }) }));
			assert.notEqual(synthetic('0.25.9'), synthetic('0.25.10'));

			// The application resolves the library to another pinned node: only what references it changes
			const graph = store.graph;
			await cp(store.file('fake-react'), store.file('fake-react-next'), { recursive: true });
			graph.nodes['npm:fake-react@18.1.0'] = Store.node('fake-react', '18.1.0');
			graph.edges.find(({ from, to }) => from.includes('@fixture/app') && to === 'npm:fake-react@18.0.0').to = 'npm:fake-react@18.1.0';
			const sources = Object.assign({}, store.sources, { 'npm:fake-react@18.1.0': store.file('fake-react-next') });
			const resolved = await this.#keys({ graph: Store.seal(graph), sources });
			assert.deepEqual(resolved.inventory.diagnostics.map(({ code }) => code), ['DYNAMIC_IMPORT_UNKNOWN']);
			assert.notEqual(resolved.main, base.main, 'A different resolution slice changes the key');
			assert.equal(resolved.widget, base.widget, 'A module that does not reference the library keeps its key');
			return `configuration, target, format, resolution${version ? `, compiler ${version.identity.version} vs ${base.identity.version}` : ' (one compiler installed: version checked on the key inputs)'}`;
		});

		await this.#report.step('key: where the sources are, how the compiler is named and unrelated packages do not change it', async () => {
			const moved = await realpath(await mkdtemp(join(tmpdir(), 'beyond-cdn-moved-')));
			try {
				await cp(store.root, moved, { recursive: true });
				const sources = Object.fromEntries(Object.entries(store.sources).map(([key, path]) => [key, path.replace(store.root, moved)]));
				assert.deepEqual(await this.#keys({ sources }).then(({ main, widget }) => [main, widget]), [base.main, base.widget]);
			} finally {
				await rm(moved, { recursive: true, force: true });
			}

			if (this.#compiler.startsWith('file:')) {
				process.env.CDN_KEYS_COMPILER = fileURLToPath(this.#compiler);
				assert.equal((await this.#keys({ compiler: 'env:CDN_KEYS_COMPILER' })).widget, base.widget);
			}

			const graph = store.graph;
			graph.nodes['npm:unrelated@9.9.9'] = Store.node('unrelated', '9.9.9');
			assert.equal((await this.#keys({ graph: Store.seal(graph) })).main, base.main);

			const { inputs } = base.inventory.items.find(({ id }) => id === WIDGET);
			const reordered = Object.fromEntries(Object.entries(inputs).reverse());
			assert.equal(Compatibility.key(reordered), Compatibility.key(inputs));
			// The storage scope is part of the lookup: as an input it is refused, never hashed and never ignored
			assert.throws(() => Compatibility.key(Object.assign({ scope: 'org:42' }, inputs)), /storage scope/);
			return 'moved store, env-selected compiler, unrelated node, member order; a scope among the inputs is refused';
		});
	}
}
