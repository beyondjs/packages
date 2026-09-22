/**
 * Sharing validation: the public subpaths of an ordinary npm package that share internal state are
 * delivered as one carrier and its facades, and every other subpath is delivered on its own.
 *
 * A public subpath is compiled as one ES module with the other subpaths kept as references, so two of them
 * whose graphs share a file would each carry a copy of it. A copy of a file that holds state is a second
 * state, and a component mounted against one of them is not the component the other knows. The delivery
 * answers that by compiling the subpath whose graph reaches the others from an entry that re-exports them
 * all, and by delivering each contained subpath as a facade over it.
 *
 * What is checked here is what a consumer receives: the outputs of a preparation, the identity of the state
 * a delivered application reads through two public subpaths, and the packages whose subpaths must keep a
 * module of their own. The browser side of the same contract is [the preparation validation](../preparation/README.md).
 *
 * ```sh
 * BEE_URL=<implementation>[,<utility>…] node --import "$BEE_NODE_DIR/register.mjs" tests/sharing/index.mjs
 * ```
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Compiler } from '@beyond-js/packages/bundlers/esbuild/processors/bundle';
import { Pinned } from '@beyond-js/packages/analysis';
import { results, step } from '../stage-1/harness.mjs';
import { Prepared } from '../preparation/prepared.mjs';
import { ENTRY, Store } from './store.mjs';

const selected = process.env.BEYOND_ESBUILD ? `file://${process.env.BEYOND_ESBUILD}` : 'esbuild';
const conditions = { platform: 'node', environment: 'development' };

const store = await new Store().create();
const compiled = await Compiler.load(selected, process.cwd());
if (compiled.error) throw new Error(`${compiled.error.code}: ${compiled.error.message}`);

/**
 * The output of a public subpath, as a consumer receives it
 */
const code = (prepared, name, subpath) => prepared.output(`module:${store.key(name)}/${subpath}`, 'js')?.code;

/**
 * Whether a public subpath is delivered as a facade: its output references its carrier and nothing else,
 * and it carries no source of the package
 */
const facade = (prepared, name, subpath, carrier) => {
	const output = prepared.output(`module:${store.key(name)}/${subpath}`, 'js');
	const references = (output?.relations?.references ?? []).map(one => one.specifier);
	return references.length === 1 && references[0] === carrier && !/\/\/ src\//.test(output.code);
};

let prepared;
let delivered;

try {
	await step('inventory: every public subpath of every fixture is reached, with no error diagnostic', async () => {
		prepared = await Prepared.of(store, selected, [ENTRY], conditions, 'esm');
		const errors = prepared.inventory.diagnostics.filter(({ severity }) => severity === 'error');
		assert.deepEqual(errors, [], errors.map(({ code: one, message }) => `${one}: ${message}`).join('\n'));

		const failed = [...prepared.units].filter(([, unit]) => unit.diagnostics.length);
		assert.deepEqual(failed.map(([id, unit]) => `${id}: ${JSON.stringify(unit.diagnostics)}`), []);
		return `${prepared.inventory.items.length} items, ${prepared.units.size} units`;
	});

	await step('roles: the subpath whose graph reaches another carries it, and that one becomes a facade', async () => {
		const pinned = new Pinned(store.graph, store.sources, conditions);
		try {
			const { opened } = await pinned.open(store.key('@fixture/shared-state'));
			const plan = await opened.plan(compiled, conditions);

			const carrier = plan.role('.');
			assert.equal(carrier.kind, 'carrier', `the root carries: ${JSON.stringify(carrier)}`);
			assert.deepEqual(carrier.contained.map(one => one.subpath), ['./state']);

			const contained = plan.role('./state');
			assert.equal(contained.kind, 'facade');
			assert.equal(contained.carrier.specifier, '@fixture/shared-state');
			return 'root carries ./state';
		} finally {
			pinned.destroy();
		}
	});

	await step('delivery: the carrier holds the shared file once and the facade holds nothing but its re-export', () => {
		const carrier = code(prepared, '@fixture/shared-state', '.');
		const contained = code(prepared, '@fixture/shared-state', 'state');

		assert.equal(carrier.split('value: 0').length - 1, 1, 'the file that holds the state is in the carrier exactly once');
		assert.ok(facade(prepared, '@fixture/shared-state', 'state', '@fixture/shared-state'), `./state re-exports its carrier and nothing else: ${contained}`);
		assert.doesNotMatch(contained, /value: 0/, 'the facade carries no copy of the state');
		return `carrier ${carrier.length} bytes, facade ${contained.trim()}`;
	});

	await step('delivery: a default export of a contained subpath keeps its name through the facade', () => {
		const contained = code(prepared, '@fixture/defaulted', 'view');
		assert.ok(facade(prepared, '@fixture/defaulted', 'view', '@fixture/defaulted'), `./view re-exports its carrier: ${contained}`);
		assert.match(contained, /as default/, 'the facade names the default export back');
		assert.equal(code(prepared, '@fixture/defaulted', '.').split('seen = []').length - 1, 1, 'the carrier holds the state once');
		return contained.trim();
	});

	await step('delivery: subpaths that reach nothing of each other are each delivered on their own', () => {
		const a = code(prepared, '@fixture/independent', '.');
		const b = code(prepared, '@fixture/independent', 'b');
		assert.ok(!facade(prepared, '@fixture/independent', '.', '@fixture/independent'), 'the root is not a facade');
		assert.ok(!facade(prepared, '@fixture/independent', 'b', '@fixture/independent'), './b is not a facade');
		assert.match(a, /"a"/);
		assert.match(b, /"b"/);
		return 'two modules, no carrier';
	});

	await step('delivery: a name two subpaths export is carried for both, each under a name of its own', () => {
		const carrier = code(prepared, '@fixture/collision', '.');
		const contained = code(prepared, '@fixture/collision', 'state');
		assert.ok(facade(prepared, '@fixture/collision', 'state', '@fixture/collision'), `./state is a facade: ${contained}`);
		assert.match(contained, /as value/, 'the facade publishes the name of its own subpath');
		assert.equal(carrier.split(`'state'`).length - 1 + carrier.split('"state"').length - 1, 1, 'the ambiguous file is carried once');
		return contained.trim();
	});

	await step('delivery: a subpath whose API cannot be listed stays on its own, with its copy', () => {
		const carrier = code(prepared, '@fixture/opaque', '.');
		const contained = code(prepared, '@fixture/opaque', 'state');
		assert.ok(!facade(prepared, '@fixture/opaque', 'state', '@fixture/opaque'), `./state is not a facade: ${contained}`);
		assert.match(contained, /export \* from "@fixture\/independent"/, './state re-exports an external package, so its names are not known');
		assert.match(carrier, /value: 0/, 'the root kept the copy of the state it reaches directly');
		assert.match(contained, /value: 0/, 'and the subpath kept its own');
		return 'two copies, which is what an API that cannot be named costs';
	});

	await step('delivery: a CommonJS package is not planned, because its subpaths are not ES modules', () => {
		const contained = code(prepared, '@fixture/commonjs', 'state');
		assert.ok(!facade(prepared, '@fixture/commonjs', 'state', '@fixture/commonjs'), `./state is not a facade: ${contained}`);
		assert.match(contained, /value: 0/, './state holds the state');

		// What keeps one state here is the boundary alone: the root requires the entry point of `./state`,
		// which stays a public reference
		const references = prepared.output(`module:${store.key('@fixture/commonjs')}/.`, 'js').relations.references;
		assert.deepEqual(references.map(one => one.specifier), ['@fixture/commonjs/state']);
		return 'both delivered on their own, related by a public reference';
	});

	await step('identity: tracing the same inputs again answers the same digest and the same keys', async () => {
		const again = await Prepared.of(store, selected, [ENTRY], conditions, 'esm');
		assert.equal(again.inventory.digest, prepared.inventory.digest);

		const keys = one => one.inventory.items.map(({ id, key }) => `${id} ${key}`);
		assert.deepEqual(keys(again), keys(prepared));
		return `${prepared.inventory.digest.slice(0, 24)}…`;
	});

	await step('conditions: the production delivery keeps the roles and answers keys of its own', async () => {
		const production = await Prepared.of(store, selected, [ENTRY], { platform: 'node', environment: 'production' }, 'esm');
		const failed = [...production.units].filter(([, unit]) => unit.diagnostics.length);
		assert.deepEqual(failed.map(([id, unit]) => `${id}: ${JSON.stringify(unit.diagnostics)}`), []);

		assert.ok(facade(production, '@fixture/shared-state', 'state', '@fixture/shared-state'), './state is a facade in production too');

		const key = (one, id) => one.inventory.items.find(item => item.id === id)?.key;
		const id = `module:${store.key('@fixture/shared-state')}/.`;
		assert.notEqual(key(production, id), key(prepared, id), 'a production output is not compatible with a development one');
		return `development ${key(prepared, id).slice(0, 16)}…, production ${key(production, id).slice(0, 16)}…`;
	});

	await step('execution: the state a delivered application reads through two public subpaths is one state', async () => {
		delivered = await prepared.write();
		const entry = join(delivered.directory, 'run.mjs');
		await writeFile(entry, `import { report } from ${JSON.stringify(ENTRY)};\nconsole.log(JSON.stringify(report()));\n`);

		const observed = await run(entry, join(delivered.directory, 'importmap.json'));
		assert.deepEqual(observed, {
			// One bump through each public subpath, read through both of them: one store, not two
			shared: [2, 2],
			// The list the root writes to through its own copy of the file is the one `./view` reads
			defaulted: [2, 2],
			independent: ['a', 'b'],
			// One copy, although both subpaths export `value`: the union names every re-export
			collision: ['root:state:state', 'state'],
			// A CommonJS package is not planned: the boundary alone keeps the entry point of `./state` public
			commonjs: [1, 1],
			// Two copies: `./state` re-exports an external package, so the union cannot name its API
			opaque: [1, 0, 0]
		});
		return JSON.stringify(observed);
	});

	await step('boundary: the analysis module does not depend on the artifacts module', async () => {
		const [origin] = (process.env.BEE_URL ?? '').split(/[\s,]+/).filter(Boolean);
		assert.ok(origin, 'BEE_URL names the development server that publishes the implementation');

		const source = await (await fetch(`${origin}/analysis.js`)).text();
		assert.doesNotMatch(source, /@beyond-js\/packages\/artifacts/, 'the delivery of a shared runtime moved without a cycle');
		return 'no reference to @beyond-js/packages/artifacts';
	});
} finally {
	await rm(store.root, { recursive: true, force: true });
	delivered && (await rm(delivered.directory, { recursive: true, force: true }));
}

/**
 * Runs a delivered application in a process of its own, with the import map the preparation wrote and
 * nothing else: what it prints is what the outputs do.
 */
function run(entry, importmap) {
	const loader = join(process.env.BEE_NODE_DIR ?? '', 'register.mjs');
	const child = spawn(process.execPath, ['--import', loader, entry], {
		env: { ...process.env, BEE_URL: '', BEE_ADAPTER: '', BEE_IMPORT_MAP: importmap },
		stdio: ['ignore', 'pipe', 'pipe']
	});

	let out = '';
	let err = '';
	child.stdout.on('data', chunk => (out += chunk));
	child.stderr.on('data', chunk => (err += chunk));
	return new Promise((done, failed) => {
		child.once('error', failed);
		child.once('exit', status => (status === 0 ? done(JSON.parse(out)) : failed(new Error(`the application exited with ${status}:\n${err}`))));
	});
}

const passed = results.filter(result => result.ok).length;
console.log(`\n${passed}/${results.length} steps passed`);
process.exit(passed === results.length ? 0 : 1);
