import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Stacks } from '@beyond-js/packages/service/stacks';

const REGISTER = fileURLToPath(import.meta.resolve('@beyond-js/packages/service/stacks/register'));
const LAUNCHER = fileURLToPath(new URL('../../tests/launches/fixtures/stand-ins/launcher.mjs', import.meta.url));
const PACKAGE = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).name;

/**
 * Runs Node with the stacks registered, within a bound: `{code, stdout, stderr}`
 */
const run = (args, environment = {}) =>
	new Promise((resolve, reject) => {
		const child = spawn(process.execPath, ['--enable-source-maps', '--import', REGISTER, ...args], { env: { ...process.env, ...environment }, stdio: ['ignore', 'pipe', 'pipe'] });
		const output = { stdout: '', stderr: '' };
		['stdout', 'stderr'].forEach(stream => child[stream].setEncoding('utf8').on('data', chunk => (output[stream] += chunk)));
		const timer = setTimeout(() => (child.kill('SIGKILL'), reject(new Error('the process did not end within 10 s'))), 10000);
		child.once('exit', code => (clearTimeout(timer), resolve({ code, ...output })));
	});

test('an uncaught error is printed without the toolchain frames, and the process ends with code 1', async () => {
	const { code, stderr } = await run([LAUNCHER, 'stand-in/throws']);
	assert.equal(code, 1);
	assert.match(stderr, /^Error: stand-in failure/);
	assert.match(stderr, /launcher\.mjs:\d+:\d+/, 'the frames of the program stay');
	assert.doesNotMatch(stderr, /node:internal/, 'no frame of Node itself');
});

test('frames of the directories the environment names are hidden too, unless no frame would be left', async () => {
	const directory = fileURLToPath(new URL('../../tests/launches/fixtures/stand-ins', import.meta.url));
	const { code, stderr } = await run([LAUNCHER, 'stand-in/throws'], { [Stacks.VARIABLE]: JSON.stringify([directory]) });
	assert.equal(code, 1);
	assert.match(stderr, /launcher\.mjs/, 'a stack of toolchain frames only is printed whole');

	const stacks = new Stacks({ hidden: ['/toolchain/cli'], environment: {} });
	const stack = ['Error: x', '    at main (/work/app/main.js:3:9)', '    at run (/toolchain/cli/launcher.mjs:10:2)', '    at file:///toolchain/cli/launcher.mjs:12:1', '    at ModuleJob.run (node:internal/modules/esm/module_job:271:25)', '    at load (/home/me/.local/node_modules/@beyond-js/kernel/core.js:1:1)'].join('\n');
	assert.equal(stacks.filter(stack), 'Error: x\n    at main (/work/app/main.js:3:9)');
});

test('a missing package says what to do: the importing file, its package, and beyond install', async () => {
	const { code, stderr } = await run([LAUNCHER, 'stand-in/missing']);
	assert.equal(code, 1);
	assert.ok(stderr.startsWith(`stand-in-not-a-dependency is imported by ${LAUNCHER} but is not a dependency of ${PACKAGE}: add it to its dependencies and run beyond install`), stderr);
	assert.equal(Stacks.missing({ message: "Cannot find module '/work/app/gone.js' imported from /work/app/main.js" }), '/work/app/gone.js, imported by /work/app/main.js, does not exist');
	assert.equal(Stacks.missing(new Error('another error')), undefined);
});

test('a program that handles its uncaught errors keeps doing so', async () => {
	const script = "process.on('uncaughtException', error => console.log('handled', error.message)); setTimeout(() => { throw new Error('mine'); });";
	const { code, stdout, stderr } = await run(['-e', script]);
	assert.deepEqual([code, stdout.trim(), stderr], [0, 'handled mine', '']);
});
