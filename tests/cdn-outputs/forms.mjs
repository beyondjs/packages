/**
 * The two npm publication forms of a Beyond package: the same package consumed as sources, which are
 * compiled, and as a precompiled distribution, which is only read.
 */
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Generation } from '@beyond-js/packages/generation';
import { Layout, Publication } from '@beyond-js/packages/publication';
import { Prepared, Consumer } from './harness.mjs';

const UI = 'npm:@fixture/ui@2.0.0';
const SUBPATHS = { widget: 'module', chart: 'module', theme: 'style', extra: 'module', unused: 'module' };
const VARIANTS = [
	[{ platform: 'node', environment: 'development' }, 'esm'],
	[{ platform: 'node', environment: 'development' }, 'system'],
	[{ platform: 'browser', environment: 'development' }, 'esm']
];

export class Forms {
	#report;
	#store;
	#compiler;
	#scratch;

	constructor(report, store, compiler, scratch) {
		this.#report = report;
		this.#store = store;
		this.#compiler = compiler;
		this.#scratch = scratch;
	}

	#unit(item, conditions, format, compiler = this.#compiler) {
		const { graph, sources } = this.#store;
		return Generation.unit({ item, graph, sources, conditions, format, compiler });
	}

	/**
	 * Lays out the distribution of `@fixture/ui` from the outputs its source form generates
	 */
	async #distribute() {
		const root = this.#store.file('ui-distribution');
		let layout;
		const assets = new Set();

		for (const [subpath, kind] of Object.entries(SUBPATHS)) {
			for (const [conditions, format] of VARIANTS) {
				const generated = await this.#unit({ kind, package: UI, subpath }, conditions, format);
				assert.deepEqual(generated.diagnostics, []);
				const { name, version } = generated.provenance.inputs.compiler;
				layout = layout ?? new Layout(root, { name: '@fixture/ui', version: '2.0.0' }, { name, version });
				const related = generated.outputs.flatMap(({ relations }) => relations.assets ?? []).map(({ path }) => path);
				related.forEach(path => assets.add(path));
				const references = (generated.outputs[0].relations.references ?? []).map(({ specifier, kind }) => ({ specifier, kind }));
				const outputs = generated.outputs.map(({ kind, code, media, relations }) => ({ kind, content: code, media, of: relations.of }));
				await layout.variant({ subpath: `./${subpath}`, kind, references, assets: [...new Set(related)], conditions, format, outputs });
			}
		}
		for (const path of assets) {
			const [{ bytes, media }] = (await this.#unit({ kind: 'asset', package: UI, subpath: path }, VARIANTS[0][0], 'esm')).outputs;
			await layout.asset(path, bytes, media);
		}
		await layout.close();

		const manifest = { name: '@fixture/ui', version: '2.0.0', beyond: { publication: layout.declaration } };
		await writeFile(join(root, 'package.json'), JSON.stringify(manifest, null, '\t'));
		return { root, manifest, layout };
	}

	async run() {
		const store = this.#store;
		const widget = { kind: 'module', package: UI, subpath: 'widget' };
		const [conditions] = VARIANTS[0];

		await this.#report.step('distribution: the same package, precompiled, is read with verified digests and never compiled', async () => {
			const compiled = await this.#unit(widget, conditions, 'esm');
			const { manifest, layout } = await this.#distribute();
			assert.equal(Publication.read(manifest).form, 'distribution');
			assert.deepEqual(Object.keys(layout.manifest.modules), Object.keys(SUBPATHS).map(subpath => `./${subpath}`));
			assert.deepEqual(manifest.beyond.publication.formats, ['esm', 'system']);

			await store.add(UI, '@fixture/ui', '2.0.0', 'ui-distribution');
			// A compiler that cannot be imported proves that nothing is compiled
			const read = await this.#unit(widget, conditions, 'esm', 'a-compiler-that-is-not-installed');
			assert.deepEqual(read.diagnostics, []);
			assert.deepEqual(read.outputs.map(({ kind, digest }) => [kind, digest]), compiled.outputs.map(({ kind, digest }) => [kind, digest]));
			assert.equal(read.provenance.compiler.distributed, true);
			assert.deepEqual((await this.#unit(widget, conditions, 'system', 'a-compiler-that-is-not-installed')).outputs[0].code.slice(0, 16), 'System.register(');

			const logo = await this.#unit({ kind: 'asset', package: UI, subpath: 'widget/logo.svg' }, conditions, 'esm');
			assert.equal(logo.outputs[0].media, 'image/svg+xml');
			return `${read.outputs.length} prebuilt outputs of ./widget, identical digests to the compiled form`;
		});

		await this.#report.step('distribution: an application that depends on it is traced, generated and executed without its sources', async () => {
			const prepared = await Prepared.of(store, this.#compiler, ['@fixture/app/main'], conditions, 'esm');
			assert.deepEqual(prepared.diagnostics, []);
			assert.deepEqual([prepared.cost.read, prepared.cost.compiled], [3, 3]);
			for (const item of prepared.inventory.items) {
				const produced = [...prepared.units.values()].flatMap(({ outputs }) => outputs).filter(({ key }) => key === item.key);
				assert.ok(produced.length, `${item.id} is produced under the key of its item`);
			}
			const result = await Consumer.run('fixture', await prepared.write(join(this.#scratch, 'distributed')), this.#scratch);
			assert.equal(result.view, 'state:widget');
			assert.equal(result.chart, 'chart of widget');
			return `${prepared.cost.read} modules read from the manifest; view() = ${result.view}`;
		});

		await this.#report.step('distribution (negative): a tampered file and a variant that was not distributed are refused', async () => {
			const production = await this.#unit(widget, { platform: 'browser', environment: 'production' }, 'esm');
			assert.deepEqual(production.diagnostics.map(({ code }) => code), ['DISTRIBUTION_VARIANT_MISSING']);
			assert.match(production.diagnostics[0].message, /held: node\/development\/esm, node\/development\/system, browser\/development\/esm/);

			const file = store.file('ui-distribution/dist/node/development/esm/widget.js');
			const original = await readFile(file);
			await writeFile(file, `${original}\n// tampered`);
			const tampered = await this.#unit(widget, conditions, 'esm');
			await writeFile(file, original);
			assert.deepEqual(tampered.diagnostics.map(({ code }) => code), ['DISTRIBUTION_DIGEST_MISMATCH']);
			assert.deepEqual(tampered.outputs, []);

			await store.add(UI, '@fixture/ui', '2.0.0', 'ui');
			return 'DISTRIBUTION_VARIANT_MISSING, DISTRIBUTION_DIGEST_MISMATCH';
		});
	}
}
