/**
 * The composed modules of a workspace running on the unified development runtime, compiled by Packages.
 *
 * The runtime package is compiled in the esbuild packaging mode with the Beyond ESBuild fork, because a
 * composed artifact imports its runtime and the runtime therefore cannot be composed by itself. The fixture
 * packages select that runtime in the settings of their bundler, and the validation checks that nothing
 * registers in the legacy Kernel, which stays installed beside Packages.
 *
 * This file validates composition and the application of updates to a consumer that is already running.
 * The driver names each update file: delivery of updates is validated separately and is not claimed here.
 */
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Workspace } from '@beyond-js/packages/workspace';
import { Artifacts } from '@beyond-js/packages/artifacts';
import { WatchersService } from '@beyond-js/packages/watchers';
import { Consumer, Fixture, Fork, Runtime, once, results, step, timeout } from './harness.mjs';

const { WATCHERS_URL } = process.env;
if (!WATCHERS_URL) throw new Error('Set WATCHERS_URL to the Engine server that serves the watchers utility.');

const fork = new Fork();
const runtime = new Runtime();
// Packages runs in this process, so the variable the runtime manifest names is read here
process.env.BEYOND_ESBUILD_COMPILER = fork.file;

const cleanup = [];
const service = new WatchersService('watchers', { env: { BEE_URL: WATCHERS_URL } });
await service.start();
cleanup.push(() => service.stop());

const fixture = await new Fixture().create(runtime);
cleanup.push(() => fixture.destroy());
const workspace = new Workspace(fixture.root, { watcher: true });
cleanup.push(() => workspace.destroy());
const artifacts = new Artifacts(workspace, { path: fixture.file('.artifacts'), conditions: { platform: 'node' } });

const find = (report, specifier) => report.artifacts.find(one => one.specifier === specifier);
const SHARED = '@fixture/shared/text';
const APP = '@fixture/app/main';
let report;
let consumer;

/**
 * Edits a source of the shared module, waits for the watched change and rebuilds
 */
const edit = async (file, mutate) => {
	const conditional = workspace.packages.get('shared').modules.get('./text').conditionals.get('node');
	const path = fixture.file('shared/text', file);
	const changed = once(conditional, 'change');
	await writeFile(path, mutate(await readFile(path, 'utf8')));
	await Promise.race([changed, timeout(10000, `change of ${file}`)]);
	return artifacts.build();
};

try {
	await step('composition: Packages compiles the runtime with the fork and composes the fixture against it', async () => {
		report = await artifacts.build();
		assert.deepEqual(report.errors, []);

		const compiled = find(report, Runtime.specifier);
		assert.deepEqual([compiled.composition, compiled.ims, compiled.patch], ['packaged', [], undefined]);
		assert.deepEqual([compiled.compiler.specifier, compiled.compiler.location, compiled.compiler.assigned],
			['env:BEYOND_ESBUILD_COMPILER', fork.file, true]);
		assert.deepEqual(compiled.exports, ['Bundle', 'Events', 'Module', 'Package', 'instances']);

		for (const specifier of [SHARED, APP]) {
			const composed = find(report, specifier);
			assert.equal(composed.composition, 'creators');
			const code = await readFile(join(report.path, composed.file), 'utf8');
			assert.ok(code.includes(`from '${Runtime.specifier}'`), `${specifier} imports the selected runtime`);
			assert.ok(!code.includes('@beyond-js/kernel'), `${specifier} does not name the legacy runtime`);
		}
		return `runtime packaged by esbuild ${compiled.compiler.version} (${compiled.inputs.length} inputs); ${find(report, SHARED).ims.length} + ${find(report, APP).ims.length} creators`;
	});

	await step('execution: a running consumer composes both packages in the unified runtime and registers nothing in the legacy Kernel', async () => {
		consumer = await new Consumer().start({ BEE_IMPORT_MAP: join(report.path, report.importmap) }, fixture.file('.consumer'));
		cleanup.push(() => consumer.stop());

		assert.deepEqual(await consumer.call('load', { handle: 'app', specifier: APP }), ['__beyond_pkg', 'add', 'direct', 'hmr', 'main']);
		await consumer.call('load', { handle: 'shared', specifier: SHARED });
		assert.equal(await consumer.call('call', { handle: 'app', name: 'main' }), '[app] Hello World!');
		assert.equal(await consumer.call('call', { handle: 'app', name: 'direct' }), '[app] Hi there!');
		// Node resolves what this test process file imports from its own location, where Packages has the legacy
		// Kernel installed, so that runtime can be imported here. What matters is that nothing registered in it.
		assert.deepEqual((await consumer.call('registry', { specifier: '@beyond-js/kernel/bundle' })) ?? [], [], 'Nothing uses the legacy runtime');
		assert.deepEqual(await consumer.call('registry', { specifier: Runtime.specifier }), ['@fixture/app@0.1.0/main', '@fixture/shared@0.1.0/text']);
		assert.deepEqual([await consumer.call('call', { handle: 'app', name: 'add' }), await consumer.call('call', { handle: 'app', name: 'add' })], [1, 2]);
		return 'both packages registered in one runtime registry; store counted to 2';
	});

	await step('update: an internal module changes; direct exports and re-exports are current, other internal state is kept', async () => {
		const rebuilt = await edit('format.ts', source => source.replace('${subject}!`', '${subject}!!`'));
		assert.deepEqual(rebuilt.errors, []);
		await consumer.call('patch', { file: join(rebuilt.path, find(rebuilt, SHARED).patch) });

		assert.equal(await consumer.call('call', { handle: 'app', name: 'main' }), '[app] Hello World!!', 'A function that reads the internal module');
		assert.equal(await consumer.call('call', { handle: 'app', name: 'direct' }), '[app] Hi there!!',
			'The public re-export, read through the original import of another public module, in the same update');
		assert.equal(await consumer.call('call', { handle: 'shared', name: 'format', args: ['Hey', 'you'] }), 'Hey you!!');

		assert.equal(await consumer.call('call', { handle: 'app', name: 'add' }), 3, 'The store kept its state');
		assert.deepEqual(await consumer.call('evaluations'), { 'shared/index': 1, 'shared/format': 2, 'shared/store': 1 });
		assert.equal(await consumer.call('read', { handle: 'shared', name: 'captured' }), 'Hello once!',
			'Boundary: a value computed when the unchanged entry was evaluated is not recomputed');
		return 'format evaluated again, index and store not; re-export current after one update; captured value is a recorded boundary';
	});

	await step('update: the entry point that re-exports is itself replaced', async () => {
		const rebuilt = await edit('index.ts', source => source.replace("format('Hello', subject)", "format('Howdy', subject)"));
		assert.deepEqual(rebuilt.errors, []);
		await consumer.call('patch', { file: join(rebuilt.path, find(rebuilt, SHARED).patch) });

		assert.equal(await consumer.call('call', { handle: 'app', name: 'main' }), '[app] Howdy World!!');
		assert.equal(await consumer.call('call', { handle: 'app', name: 'direct' }), '[app] Hi there!!', 'Its re-exports still resolve');
		assert.equal(await consumer.call('call', { handle: 'app', name: 'add' }), 4, 'The store kept its state');
		assert.equal(await consumer.call('read', { handle: 'shared', name: 'captured' }), 'Hello once!!', 'The entry was evaluated again, so it recomputed');
		assert.deepEqual(await consumer.call('evaluations'), { 'shared/index': 2, 'shared/format': 2, 'shared/store': 1 });
		return 'the legacy runtime refused this replacement; here the entry is evaluated again and the store is not';
	});

	await step('recovery: a source that does not compile publishes nothing, and its correction updates the same consumer', async () => {
		const valid = await readFile(fixture.file('shared/text/format.ts'), 'utf8');
		const broken = await edit('format.ts', () => 'export const format = ;\n');
		assert.ok(broken.errors.length && !find(broken, SHARED), 'The module is reported and not published');
		assert.equal(await consumer.call('call', { handle: 'app', name: 'main' }), '[app] Howdy World!!', 'The running consumer keeps its last state');

		const recovered = await edit('format.ts', () => valid.replace('${subject}!!`', '${subject}?`'));
		assert.deepEqual(recovered.errors, []);
		await consumer.call('patch', { file: join(recovered.path, find(recovered, SHARED).patch) });
		assert.equal(await consumer.call('call', { handle: 'app', name: 'main' }), '[app] Howdy World?');
		assert.equal(await consumer.call('call', { handle: 'app', name: 'add' }), 5, 'The store kept its state');
		return 'failed build reported; corrected source applied to the same process';
	});
	await step('recovery: a creator that throws fails its update and does not lock the module for the corrected one', async () => {
		const valid = await readFile(fixture.file('shared/text/format.ts'), 'utf8');
		const throwing = await edit('format.ts', () => `throw new Error('evaluation failed');\n${valid}`);
		assert.deepEqual(throwing.errors, [], 'It compiles: the failure is at evaluation');
		await assert.rejects(consumer.call('patch', { file: join(throwing.path, find(throwing, SHARED).patch) }), /evaluation failed/);

		const corrected = await edit('format.ts', () => valid.replace('${subject}?`', '${subject}.`'));
		await consumer.call('patch', { file: join(corrected.path, find(corrected, SHARED).patch) });
		assert.equal(await consumer.call('call', { handle: 'app', name: 'main' }), '[app] Howdy World.');
		assert.equal(await consumer.call('call', { handle: 'app', name: 'add' }), 6, 'The store kept its state');
		return 'the legacy Kernel answers the corrected creator with "Cyclical import found"; here it is evaluated';
	});
} finally {
	for (const release of cleanup.reverse()) await Promise.resolve(release()).catch(() => undefined);
}

const failed = results.filter(result => !result.ok);
console.log(`\n${results.length - failed.length}/${results.length} steps passed`);
process.exit(failed.length ? 1 : 0);
