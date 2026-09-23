/**
 * Reproducibility across locations, per processor: the same pinned application generated from two
 * extraction directories, the second reached through a symbolic link, compared unit by unit.
 *
 * Every unit is classified by what compiled it, read from its provenance: the bundler that composed it or
 * the packaging compiler, and the kinds of sources it read. The matrix names each processor with the units
 * that exercised it, so a processor no unit reached is visible as such instead of passing by absence.
 */
import assert from 'node:assert/strict';
import { homedir, tmpdir } from 'node:os';
import { realpath } from 'node:fs/promises';
import { Prepared } from '../../preparation/prepared.mjs';

const PROCESSORS = {
	'esbuild (packaging, Beyond sources)': unit => unit.compiler === 'esbuild' && unit.form === 'source',
	'esbuild (ordinary npm)': unit => unit.compiler === 'esbuild' && unit.form === 'npm',
	'ts bundler: TypeScript': unit => unit.composed && unit.files.some(file => /\.tsx?$/.test(file)),
	'ts bundler: Sass': unit => unit.composed && unit.files.some(file => file.endsWith('.scss')),
	'ts bundler: Tailwind': unit => unit.composed && unit.id.endsWith('/tw'),
	'ts bundler: Vue': unit => unit.composed && unit.files.some(file => file.endsWith('.vue')),
	'ts bundler: Svelte': unit => unit.composed && unit.files.some(file => file.endsWith('.svelte')),
	'stylesheet published through exports': unit => unit.id.startsWith('style:') && unit.files.some(file => file.endsWith('.css'))
};

export class Matrix {
	#compiler;
	#rows = new Map(Object.keys(PROCESSORS).map(name => [name, []]));

	get rows() {
		return this.#rows;
	}

	constructor(compiler) {
		this.#compiler = compiler;
	}

	/**
	 * Every unit as comparable text, everything but how long it took, with what compiled it
	 */
	async #generated(graph, sources, entries, conditions) {
		const prepared = await Prepared.of({ graph, sources }, this.#compiler, entries, conditions, 'esm');
		const errors = prepared.inventory.diagnostics.filter(({ severity }) => severity === 'error');
		assert.deepEqual(errors, [], errors.map(({ code, message }) => `${code}: ${message}`).join('\n'));

		const units = new Map();
		for (const [id, { outputs, warnings, diagnostics, provenance }] of prepared.units) {
			assert.deepEqual(diagnostics, [], `${id}: ${JSON.stringify(diagnostics)}`);
			const comparable = outputs.map(output => Object.assign({}, output, { bytes: output.bytes && Buffer.from(output.bytes).toString('base64') }));
			const text = JSON.stringify({ outputs: comparable, warnings, provenance: Object.assign({}, provenance, { ms: 0 }) });
			const compiler = provenance?.compiler?.name;
			units.set(id, { id, text, compiler, composed: !!provenance?.compiler?.bundler, files: provenance?.files ?? [], maps: outputs.filter(({ kind }) => kind === 'map') });
		}
		return units;
	}

	/**
	 * @param first The sources in one directory
	 * @param second The same sources in another directory, reached through a link
	 * @param roots The directories no output may name
	 * @param forms The publication form of the package of a unit, by unit id
	 */
	async compare({ graph, first, second, entries, conditions, roots, forms }) {
		const one = await this.#generated(graph, first, entries, conditions);
		const other = await this.#generated(graph, second, entries, conditions);
		assert.deepEqual([...other.keys()].sort(), [...one.keys()].sort());

		const hosts = [...roots, tmpdir(), await realpath(tmpdir()), homedir(), process.cwd()];
		for (const [id, unit] of one) {
			assert.equal(other.get(id).text, unit.text, `${id} differs between the two extraction directories`);
			for (const host of hosts) assert.ok(!unit.text.includes(host) && !other.get(id).text.includes(host), `${id} names "${host}"`);

			// A source of the package is named in the package, never as a file outside it
			for (const map of unit.maps) {
				const names = JSON.parse(map.code).sources;
				assert.ok(names.every(name => /^beyond:\/\/(@[^/]+\/)?[^/@]+@[^/]+\//.test(name)), `${id}: ${names.join(', ')}`);
				const own = names.filter(name => /\.(tsx?|vue|svelte|scss)$/.test(name) && name.includes('/~outside/'));
				assert.deepEqual(own, [], `${id} names sources of its own package as outside it`);
			}

			unit.form = forms(id);
			for (const [name, applies] of Object.entries(PROCESSORS)) applies(unit) && this.#rows.get(name).push(`${conditions.environment}:${id}`);
		}
		return one.size;
	}
}
