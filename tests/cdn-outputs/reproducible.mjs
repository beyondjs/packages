/**
 * Outputs do not depend on where a package was extracted: the same store placed in two different
 * directories yields byte-identical outputs, maps, relations and provenance, and no host path is in any of
 * them. It covers Beyond sources, a style module, static files and adapted CommonJS packages, in both
 * formats, and the real React packages when they are available.
 */
import assert from 'node:assert/strict';
import { cp, mkdtemp, realpath, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { Prepared } from './harness.mjs';

const CONDITIONS = [{ platform: 'node', environment: 'development' }, { platform: 'browser', environment: 'production' }];

export class Reproducible {
	#report;
	#compiler;

	constructor(report, compiler) {
		this.#report = report;
		this.#compiler = compiler;
	}

	/**
	 * Every unit of an application, as comparable text: everything but how long it took
	 */
	async #generated(graph, sources, entries) {
		const units = {};
		for (const conditions of CONDITIONS) {
			for (const format of ['esm', 'system']) {
				const prepared = await Prepared.of({ graph, sources }, this.#compiler, entries, conditions, format);
				assert.deepEqual(prepared.diagnostics, []);
				for (const [id, { outputs, warnings, provenance }] of prepared.units) {
					const comparable = outputs.map(output => Object.assign({}, output, { bytes: output.bytes && Buffer.from(output.bytes).toString('base64') }));
					units[`${conditions.platform}/${format}/${id}`] = JSON.stringify({ outputs: comparable, warnings, provenance: Object.assign({}, provenance, { ms: 0 }) });
				}
				units[`${conditions.platform}/${format}/inventory`] = JSON.stringify(prepared.inventory);
			}
		}
		return units;
	}

	/**
	 * @param name What is generated, for the report
	 * @param store A store, or what stands for one: `{root, graph, sources}`
	 */
	async check(name, store, entries) {
		await this.#report.step(`reproducible: ${name} extracted in two directories yields identical outputs, maps and digests, without host paths`, async () => {
			const moved = await realpath(await mkdtemp(join(tmpdir(), 'beyond-cdn-elsewhere-')));
			try {
				await cp(store.root, join(moved, 'nested/store'), { recursive: true });
				const relocated = Object.fromEntries(Object.entries(store.sources).map(([key, path]) => [key, path.replace(store.root, join(moved, 'nested/store'))]));
				const first = await this.#generated(store.graph, store.sources, entries);
				const second = await this.#generated(store.graph, relocated, entries);

				assert.deepEqual(Object.keys(second), Object.keys(first));
				for (const unit of Object.keys(first)) assert.equal(second[unit], first[unit], `${unit} differs between the two extraction directories`);

				// The extraction roots, the temporary directory in both its spellings, the home directory and the
				// directory this run started in, under which the selected compiler may be installed
				const hosts = [store.root, moved, tmpdir(), await realpath(tmpdir()), homedir(), process.cwd()];
				for (const [unit, text] of Object.entries(first).concat(Object.entries(second))) {
					for (const host of hosts) assert.ok(!text.includes(host), `${unit} contains "${host}"`);
				}

				const maps = Object.values(first).flatMap(text => JSON.parse(text).outputs ?? []).filter(({ kind }) => kind === 'map');
				const names = maps.flatMap(({ code }) => JSON.parse(code).sources);
				assert.ok(maps.length && names.every(source => /^beyond:\/\/(@[^/]+\/)?[^/@]+@[^/]+\//.test(source)), 'Every source of every map is under the virtual root of its package');
				const generated = [...new Set(names.filter(source => source.includes('/~generated/')).map(source => source.replace(/^.*\/~generated\//, '~generated/').replace(/\/.*$/, '/…')))];
				return `${Object.keys(first).length} documents identical, ${maps.length} maps, ${new Set(names).size} sources (${generated.join(', ') || 'none generated'})`;
			} finally {
				await rm(moved, { recursive: true, force: true });
			}
		});
	}
}
