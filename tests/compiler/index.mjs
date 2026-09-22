/**
 * Compiler validation: what a development service does when the process of its compiler ends.
 *
 * The compiler of the packaging mode runs in a child process of its own, which a memory ceiling of a
 * container can kill without killing the service. What the service must never do then is answer with a
 * stale success or with a build that never lands: the failure has to be terminal, named as itself and not
 * as a source error, and a later build has to work again.
 *
 * A controlled termination stands in for the ceiling: the child is killed. A real cgroup kill was not
 * exercised here, and this validation does not establish one.
 *
 * ```sh
 * BEE_URL=<implementation>[,<utility>…] WATCHERS_URL=<watchers> \
 *   node --import "$BEE_NODE_DIR/register.mjs" tests/compiler/index.mjs
 * ```
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cp, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WatchersService } from '@beyond-js/packages/watchers';
import { Hosted } from '../../service/host/hosted.mjs';
import { Description } from '../../service/host/description.mjs';
import { results, step } from '../stage-1/harness.mjs';

const { WATCHERS_URL } = process.env;
if (!WATCHERS_URL) throw new Error('Set WATCHERS_URL to the Engine server that serves the watchers utility.');

const here = dirname(fileURLToPath(import.meta.url));
const root = await realpath(await mkdtemp(join(tmpdir(), 'beyond-compiler-')));
await cp(join(here, 'fixture'), root, { recursive: true });

const service = new WatchersService('watchers', { env: { BEE_URL: WATCHERS_URL } });
const settings = { root, standalone: true };
let hosted;
let description;

/**
 * The child processes of this one that are the compiler, which is what a ceiling kills
 */
const children = () =>
	execFileSync('ps', ['-axo', 'pid=,ppid=,command='], { encoding: 'utf8' })
		.split('\n')
		.filter(line => line.includes('--service=') && Number(line.trim().split(/\s+/)[1]) === process.pid)
		.map(line => Number(line.trim().split(/\s+/)[0]));

/**
 * What the service says about the one module of the fixture
 */
const state = async () => (await description.state()).modules.find(one => one.specifier === '@fixture/compiler/packaged');

try {
	await step('the service builds the packaged module', async () => {
		await service.start();
		hosted = new Hosted(settings, message => console.log(`       service: ${message}`));
		await hosted.ready;
		description = new Description({ ...settings, versions: {} }, hosted);

		const module = await state();
		assert.equal(module?.status, 'valid', JSON.stringify(module));
		assert.ok(children().length, 'the compiler runs in a process of its own');
		return `${module.hash}, compiler child ${children().join(', ')}`;
	});

	await step('a compiler that ends is a failed build naming it, not a stale success and not a pending one', async () => {
		const before = await state();
		children().forEach(pid => process.kill(pid, 'SIGKILL'));
		await new Promise(resolve => setTimeout(resolve, 300));

		// The edit is what asks for a build; the compiler it would use is no longer there
		await writeFile(join(root, 'packaged', 'index.ts'), `export const packaged = (): string => 'packaged 2';\n`);

		const deadline = Date.now() + 30000;
		let module;
		while (Date.now() < deadline) {
			module = await state();
			if (module?.status === 'invalid') break;
			assert.notEqual(module?.hash, void 0, 'the service still answers');
			await new Promise(resolve => setTimeout(resolve, 200));
		}

		assert.equal(module?.status, 'invalid', `the build failed instead of answering ${JSON.stringify(module)} (was ${before.hash})`);
		assert.ok(
			module.diagnostics.some(({ code }) => code === 'COMPILER_UNAVAILABLE'),
			`the failure names the compiler: ${JSON.stringify(module.diagnostics)}`
		);
		const [named] = module.diagnostics.filter(({ code }) => code === 'COMPILER_UNAVAILABLE');
		assert.match(named.message, /memory ceiling/, 'the diagnostic says what this looks like in a container');
		return `${module.code}: ${named.code}`;
	});

	await step('a later build has a compiler again and the module is valid', async () => {
		await writeFile(join(root, 'packaged', 'index.ts'), `export const packaged = (): string => 'packaged 3';\n`);

		const deadline = Date.now() + 30000;
		let module;
		while (Date.now() < deadline) {
			module = await state();
			if (module?.status === 'valid') break;
			await new Promise(resolve => setTimeout(resolve, 200));
		}
		assert.equal(module?.status, 'valid', `the module builds again: ${JSON.stringify(module)}`);
		assert.ok(children().length, 'a new compiler process is running');
		return `${module.hash}, compiler child ${children().join(', ')}`;
	});
} finally {
	hosted?.destroy();
	await new Promise(resolve => setTimeout(resolve, 500));
	await service.stop().catch(error => console.log(`watchers: ${error.message}`));
	await rm(root, { recursive: true, force: true });
}

const passed = results.filter(result => result.ok).length;
console.log(`\n${passed}/${results.length} steps passed`);
process.exit(passed === results.length ? 0 : 1);
