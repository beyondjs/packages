/**
 * Backends validation: what a preparation for Node writes for the npm packages a backend depends on, and what
 * the delivered backend does when it runs.
 *
 * - A builtin is written with its `node:` scheme in a Node output (`util` is `node:util`), the one spelling every
 *   runtime with Node's builtins reads, and is left as written in a browser output.
 * - A guarded `require` of a package the manifest declares optional, which the graph does not hold, throws
 *   `MODULE_NOT_FOUND` when it runs instead of failing the analysis; a package nothing declares is still
 *   `DEPENDENCY_UNRESOLVED`.
 *
 * ```sh
 * BEE_URL=<implementation>[,<utility>…] node --import "$BEE_NODE_DIR/register.mjs" tests/backends/index.mjs
 * ```
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Toolchain } from '@beyond-js/packages/analysis';
import { results, step } from '../stage-1/harness.mjs';
import { Prepared } from '../preparation/prepared.mjs';
import { ENTRY, Store } from './store.mjs';

const selected = process.env.BEYOND_ESBUILD ? `file://${process.env.BEYOND_ESBUILD}` : 'esbuild';
const node = { platform: 'node', environment: 'production' };
const browser = { platform: 'browser', environment: 'production' };

const store = await new Store().create();
const code = (prepared, name) => prepared.output(`module:${store.key(name)}/.`, 'js')?.code ?? '';
const references = (prepared, name) => (prepared.output(`module:${store.key(name)}/.`, 'js')?.relations?.references ?? []).map(one => one.specifier);
const errors = prepared => prepared.inventory.diagnostics.filter(({ severity }) => severity === 'error');
const failed = prepared => [...prepared.units].filter(([, unit]) => unit.diagnostics.length).map(([id, unit]) => `${id}: ${JSON.stringify(unit.diagnostics)}`);

let prepared;
let delivered;

try {
	await step('inventory: the backend and its packages trace and generate for Node with no error, the optional packages absent', async () => {
		prepared = await Prepared.of(store, selected, [ENTRY], node, 'esm');
		assert.deepEqual(errors(prepared), [], JSON.stringify(errors(prepared)));
		assert.deepEqual(failed(prepared), []);
		return `${prepared.inventory.items.length} items`;
	});

	await step('builtins: a Node output writes every builtin with its node: scheme, required or imported', () => {
		const written = code(prepared, '@fixture/builtins');
		assert.match(written, /from\s*"node:util"/);
		assert.match(written, /from\s*"node:fs\/promises"/);
		assert.match(written, /from\s*"node:path"/);
		assert.doesNotMatch(written, /from\s*"(util|fs\/promises|path)"/, 'no bare builtin is left');
		assert.deepEqual(references(prepared, '@fixture/builtins'), ['node:events', 'node:fs/promises', 'node:path', 'node:util']);
		assert.match(written, /ns\w*\.default !== void 0 \? ns\w*\.default : ns|\.default!==void 0\?/, 'a required builtin is its default export');
		const app = prepared.output(`module:${store.key('@fixture/app')}/main`, 'js');
		assert.match(app.code, /from\s*"node:os"/, 'an ES module import of a builtin too');
		return references(prepared, '@fixture/builtins').join(', ');
	});

	await step('builtins: a browser output leaves a builtin as written, and the analysis warns of it', async () => {
		const web = await Prepared.of(store, selected, ['@fixture/builtins'], browser, 'esm');
		assert.match(code(web, '@fixture/builtins'), /from\s*"util"/);
		assert.ok(web.inventory.diagnostics.some(({ code: one }) => one === 'NODE_BUILTIN_REFERENCED'));
		return 'util stays util';
	});

	await step('keys: the boundary revision is part of a Node key and of no browser key', async () => {
		assert.equal(Toolchain.BOUNDARY, '2');
		const web = await Prepared.of(store, selected, ['@fixture/builtins'], browser, 'esm');
		const key = one => one.inventory.items.find(item => item.id === `module:${store.key('@fixture/builtins')}/.`)?.key;
		assert.notEqual(key(prepared), key(web));
		return `Toolchain.BOUNDARY ${Toolchain.BOUNDARY}`;
	});

	await step('optional: a guarded require of an absent optional package reads a module that throws, and no reference', () => {
		const written = code(prepared, '@fixture/optional');
		assert.deepEqual(references(prepared, '@fixture/optional'), []);
		assert.doesNotMatch(written, /from\s*"absent-/, 'nothing absent is imported');
		assert.match(written, /MODULE_NOT_FOUND/);
		return 'absent-peer, absent-optional/sub';
	});

	await step('undeclared: a require of a package nothing declares is still DEPENDENCY_UNRESOLVED', async () => {
		const traced = await Prepared.of(store, selected, ['@fixture/undeclared'], node, 'esm');
		const codes = errors(traced).map(({ code: one }) => one);
		assert.deepEqual(codes, ['DEPENDENCY_UNRESOLVED']);
		return codes[0];
	});

	await step('execution: the delivered backend runs, its builtins load and each absent optional package answers MODULE_NOT_FOUND', async () => {
		delivered = await prepared.write();
		const entry = join(delivered.directory, 'run.mjs');
		await writeFile(entry, `import { report } from ${JSON.stringify(ENTRY)};\nconsole.log(JSON.stringify(report()));\n`);
		const observed = await run(entry, join(delivered.directory, 'importmap.json'));
		assert.deepEqual(observed, { inspected: '{ a: 1 }', reads: true, joined: 'a/b', emitter: true, codes: ['MODULE_NOT_FOUND', 'MODULE_NOT_FOUND'], host: 'string' });
		return JSON.stringify(observed);
	});
} finally {
	await rm(store.root, { recursive: true, force: true });
	delivered && (await rm(delivered.directory, { recursive: true, force: true }));
}

/**
 * Runs a delivered application in a process of its own, with the import map the preparation wrote and nothing else
 */
function run(entry, importmap) {
	const loader = join(process.env.BEE_NODE_DIR ?? '', 'register.mjs');
	const child = spawn(process.execPath, ['--import', loader, entry], { env: { ...process.env, BEE_URL: '', BEE_ADAPTER: '', BEE_IMPORT_MAP: importmap }, stdio: ['ignore', 'pipe', 'pipe'] });
	let out = '';
	let err = '';
	child.stdout.on('data', chunk => (out += chunk));
	child.stderr.on('data', chunk => (err += chunk));
	return new Promise((done, failed) => {
		child.once('error', failed);
		child.once('exit', status => (status === 0 ? done(JSON.parse(out)) : failed(new Error(`the backend exited with ${status}:\n${err}`))));
	});
}

const passed = results.filter(result => result.ok).length;
console.log(`\n${passed}/${results.length} steps passed`);
process.exit(passed === results.length ? 0 : 1);
