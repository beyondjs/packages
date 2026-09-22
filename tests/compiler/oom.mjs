/**
 * Compiler validation under a real memory ceiling: the kernel's memory controller, not this process, ends
 * the compiler.
 *
 * It runs the same service path as [the controlled termination](index.mjs), inside a Linux cgroup v2 whose
 * `memory.max` is set, typically a container started with `--memory`. An edit makes the module import a
 * source large enough that compiling it exceeds the ceiling. Nothing here signals any process: whether the
 * compiler was killed by the memory controller is read from the `oom_kill` counter of the cgroup, and the
 * run says which process disappeared and that this one, which hosts the service, did not.
 *
 * Outside such a cgroup it does not pass and does not fail: it reports `BLOCKED` with what it needs, and
 * exits with 2.
 *
 * The size of the source matters. It has to fit in the heap of this process, which reads it, and not in the
 * memory the compiler needs to compile it. Much larger sources end this process first, by the heap limit of
 * its own runtime, which is a different failure and not the one this validation is about.
 *
 * ```sh
 * BEE_URL=<implementation>[,<utility>…] WATCHERS_URL=<watchers> [BEYOND_OOM_MB=60] \
 *   node --import "$BEE_NODE_DIR/register.mjs" tests/compiler/oom.mjs
 * ```
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createWriteStream, existsSync, readFileSync } from 'node:fs';
import { cp, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WatchersService } from '@beyond-js/packages/watchers';
import { Hosted } from '../../service/host/hosted.mjs';
import { Description } from '../../service/host/description.mjs';
import { results, step } from '../stage-1/harness.mjs';

/**
 * The memory controller of the cgroup this process runs in
 */
class Ceiling {
	static #file = name => join('/sys/fs/cgroup', name);

	static get available() {
		const max = Ceiling.#file('memory.max');
		return existsSync(max) && /^\d+$/.test(readFileSync(max, 'utf8').trim());
	}

	static read(name) {
		return readFileSync(Ceiling.#file(name), 'utf8').trim();
	}

	/**
	 * The counters of `memory.events`, by name
	 */
	static get events() {
		return Object.fromEntries(Ceiling.read('memory.events').split('\n').map(line => line.split(' ')).map(([key, value]) => [key, Number(value)]));
	}

	static get mib() {
		const value = name => (existsSync(Ceiling.#file(name)) ? Math.round(Number(Ceiling.read(name)) / 1048576) : void 0);
		return { max: value('memory.max'), current: value('memory.current'), peak: value('memory.peak') };
	}
}

if (!Ceiling.available) {
	console.log('BLOCKED this validation needs a Linux cgroup v2 with memory.max set (a container started with --memory)');
	process.exit(2);
}

const { WATCHERS_URL, BEYOND_OOM_MB = '60' } = process.env;
if (!WATCHERS_URL) throw new Error('Set WATCHERS_URL to the Engine server that serves the watchers utility.');

const here = dirname(fileURLToPath(import.meta.url));
const root = await realpath(await mkdtemp(join(tmpdir(), 'beyond-oom-')));
await cp(join(here, 'fixture'), root, { recursive: true });

const service = new WatchersService('watchers', { env: { BEE_URL: WATCHERS_URL } });
const settings = { root, standalone: true };
let hosted;
let description;

/**
 * The processes that are the compiler: children of this one started as an esbuild service
 */
const children = () =>
	execFileSync('ps', ['-eo', 'pid=,ppid=,args='], { encoding: 'utf8' })
		.split('\n')
		.filter(line => line.includes('--service=') && Number(line.trim().split(/\s+/)[1]) === process.pid)
		.map(line => Number(line.trim().split(/\s+/)[0]));

const alive = pid => existsSync(`/proc/${pid}`);
const state = async () => (await description.state()).modules.find(one => one.specifier === '@fixture/compiler/packaged');

/**
 * Waits until the module reaches a status, answering the last state observed
 */
const until = async (status, ms) => {
	let module;
	for (const deadline = Date.now() + ms; Date.now() < deadline; await new Promise(resolve => setTimeout(resolve, 250))) {
		module = await state();
		if (module?.status === status) break;
	}
	return module;
};

/**
 * A source whose compilation needs more memory than the ceiling allows, written as a stream so that this
 * process never holds it
 */
const huge = path =>
	new Promise((resolve, reject) => {
		const out = createWriteStream(path);
		const line = 'rows.push({ a: 1, b: "abcdefghij", c: [1, 2, 3], d: { e: true } });\n';
		const count = Math.ceil((Number(BEYOND_OOM_MB) * 1048576) / line.length);
		out.write('const rows: object[] = [];\n');
		let written = 0;
		const write = () => {
			let ok = true;
			while (written < count && ok) ok = out.write(line), written++;
			written < count ? out.once('drain', write) : out.end('export const size = rows.length;\n');
		};
		out.on('finish', resolve).on('error', reject);
		write();
	});

const evidence = { ceiling: Ceiling.mib, before: Ceiling.events, service: process.pid };

try {
	await step('the service builds the packaged module under the ceiling', async () => {
		await service.start();
		hosted = new Hosted(settings, message => console.log(`       service: ${message}`));
		await hosted.ready;
		description = new Description({ ...settings, versions: {} }, hosted);

		const module = await state();
		assert.equal(module?.status, 'valid', JSON.stringify(module));
		evidence.compiler = children();
		assert.ok(evidence.compiler.length, 'the compiler runs in a process of its own');
		return `memory.max ${evidence.ceiling.max} MiB, current ${Ceiling.mib.current} MiB, compiler ${evidence.compiler.join(', ')}`;
	});

	await step('the memory controller ends the compiler and the build fails naming it; the service lives', async () => {
		await huge(join(root, 'packaged', 'huge.ts'));
		await writeFile(join(root, 'packaged', 'index.ts'), `import { size } from './huge';\nexport const packaged = (): string => \`packaged \${size}\`;\n`);

		const module = await until('invalid', 600000);
		evidence.after = Ceiling.events;
		evidence.peak = Ceiling.mib.peak;
		evidence.ended = evidence.compiler.filter(pid => !alive(pid));

		assert.ok(evidence.after.oom_kill > evidence.before.oom_kill, `the memory controller killed a process: ${JSON.stringify(evidence)}`);
		assert.deepEqual(evidence.ended, evidence.compiler, 'the process it killed is the compiler');
		assert.ok(alive(process.pid), 'the service, this process, is alive');
		assert.equal(module?.status, 'invalid', `the build failed: ${JSON.stringify(module)}`);
		assert.ok(module.diagnostics.some(({ code }) => code === 'COMPILER_UNAVAILABLE'), JSON.stringify(module.diagnostics));
		return `oom_kill ${evidence.before.oom_kill} → ${evidence.after.oom_kill}, compiler ${evidence.ended.join(', ')} ended, peak ${evidence.peak ?? '?'} MiB, COMPILER_UNAVAILABLE`;
	});

	await step('a later build has a compiler again and the module is valid', async () => {
		await writeFile(join(root, 'packaged', 'index.ts'), `export const packaged = (): string => 'packaged 3';\n`);
		await rm(join(root, 'packaged', 'huge.ts'), { force: true });

		const module = await until('valid', 120000);
		assert.equal(module?.status, 'valid', `the module builds again: ${JSON.stringify(module)}`);
		const now = children();
		assert.ok(now.length && now.every(pid => !evidence.compiler.includes(pid)), 'a new compiler process is running');
		return `${module.hash}, compiler ${now.join(', ')}, oom_kill ${Ceiling.events.oom_kill}`;
	});
} finally {
	hosted?.destroy();
	await new Promise(resolve => setTimeout(resolve, 500));
	await service.stop().catch(error => console.log(`watchers: ${error.message}`));
	await rm(root, { recursive: true, force: true });
	console.log(`evidence ${JSON.stringify(evidence)}`);
}

const passed = results.filter(result => result.ok).length;
console.log(`\n${passed}/${results.length} steps passed`);
process.exit(passed === results.length ? 0 : 1);
