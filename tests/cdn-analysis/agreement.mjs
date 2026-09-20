/**
 * Agreement with the CDN contracts: what `Publication.read` accepts and refuses is what the fixtures of
 * `beyond-publication/1` say, the graph this validation traces is a valid `beyond-graph/1`, the graphs of
 * that contract are readable, and every inventory `Analysis.trace` produces validates against
 * `beyond-inventory/1` with keys that are the digest of their inputs.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Publication } from '@beyond-js/packages/publication';
import { Graph, Compatibility } from '@beyond-js/packages/analysis';
import { Contracts } from './contracts.mjs';

export class Agreement {
	#report;
	#store;
	#trace;
	#contracts = new Contracts();

	/**
	 * @param trace Traces the fixture application, with the request members to override
	 */
	constructor(report, store, trace) {
		this.#report = report;
		this.#store = store;
		this.#trace = trace;
	}

	async run() {
		const contracts = this.#contracts;
		const names = ['contract: Publication.read agrees with the beyond-publication/1 fixtures', 'contract: graphs are valid beyond-graph/1 and readable', 'contract: inventories validate against beyond-inventory/1'];
		if (contracts.unavailable) return names.forEach(name => this.#report.skip(name, contracts.unavailable));

		await this.#report.step(names[0], async () => {
			const valid = await contracts.fixtures('publication', 'valid');
			const invalid = await contracts.fixtures('publication', 'invalid');
			// A fixture is a whole manifest, or only the value of its `beyond.publication` field
			const manifest = ({ file, document }) => (file.startsWith('manifest.') ? document : { name: '@fixture/declared', version: '1.0.0', beyond: { publication: document } });

			for (const fixture of valid) {
				const read = Publication.read(manifest(fixture));
				assert.deepEqual(read.diagnostics, [], fixture.file);
				assert.equal(read.form, manifest(fixture).beyond?.publication?.form ?? 'npm', fixture.file);
			}
			for (const fixture of invalid) {
				const read = Publication.read(manifest(fixture));
				assert.ok(read.diagnostics.length, `${fixture.file} is refused`);
				assert.equal(read.form, undefined, `${fixture.file} is never treated as an ordinary npm package`);
			}
			return `${valid.length} accepted, ${invalid.length} refused (${invalid.map(({ file }) => file.replace(/^\w+\.|\.json$/g, '')).join(', ')})`;
		});

		await this.#report.step(names[1], async () => {
			const validate = await contracts.validator('graph', 'graph');
			assert.deepEqual(validate(this.#store.graph), [], 'The graph of this validation is a valid beyond-graph/1');

			const fixtures = await contracts.fixtures('graph', 'valid');
			for (const { file, document } of fixtures) {
				const graph = new Graph(document);
				assert.deepEqual(graph.diagnostics, [], file);
				assert.equal(graph.digest, document.digest, file);
				assert.deepEqual(graph.keys, Object.keys(document.nodes).sort(), file);
			}

			const { document } = fixtures.find(({ file }) => file === 'graph.peer-context.json');
			const peer = document.edges.find(({ kind }) => kind === 'peer');
			assert.equal(new Graph(document).resolve(peer.from, document.nodes[peer.to].name, peer.context).key, peer.to);
			return `${fixtures.length} contract graphs read (cycle, diamond, multi-version, optional, override, peer context, manifest fetch)`;
		});

		await this.#report.step(names[2], async () => {
			const validate = await contracts.validator('inventory', 'inventory');
			const sha256 = text => `sha256-${createHash('sha256').update(text).digest('hex')}`;
			const traces = {
				browser: await this.#trace(),
				declared: await this.#trace({ declared: { '@fixture/app/main': ['@fixture/ui/extra'] } }),
				system: await this.#trace({ format: 'system', conditions: { platform: 'node', environment: 'production' } }),
				npm: await this.#trace({ entries: [{ specifier: 'fake-react-dom/client', target: 'backend' }] })
			};

			let items = 0;
			for (const [name, inventory] of Object.entries(traces)) {
				assert.deepEqual(validate(inventory), [], `${name} inventory`);
				const { digest, ...document } = inventory;
				assert.equal(digest, sha256(Compatibility.canonical(document)), `${name}: the digest is the one of the canonical document`);
				for (const item of inventory.items) assert.equal(item.key, sha256(Compatibility.canonical(item.inputs)), item.id);
				items += inventory.items.length;
			}

			// The contract refuses a storage scope among the inputs, and so does the key
			const [item] = traces.browser.items;
			const scoped = structuredClone(traces.browser);
			scoped.items[0].inputs.scope = 'org:42';
			assert.ok(validate(scoped).length, 'A scope among the inputs is not a valid inventory');
			assert.throws(() => Compatibility.key(Object.assign({ scope: 'org:42' }, item.inputs)), TypeError);

			const fixtures = await contracts.fixtures('inventory', 'valid');
			for (const { file, document } of fixtures) for (const one of document.items) assert.equal(Compatibility.key(one.inputs), one.key, `${file} ${one.id}`);
			return `${Object.keys(traces).length} traced inventories valid (${items} items); Compatibility.key reproduces the keys of ${fixtures.length} contract fixtures`;
		});
	}
}
