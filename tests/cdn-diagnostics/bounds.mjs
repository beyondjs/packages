/**
 * The bounds of a check and what a result discloses: limits, cancellation, requests that cannot be checked,
 * the measured cost, and the absence of any location of the host.
 */
import assert from 'node:assert/strict';
import { realpath } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { Diagnostics } from '@beyond-js/packages/diagnostics';
import { step } from './harness.mjs';

const conditions = { platform: 'node' };

export async function bounds(fixture) {
	await step('limits: more files than allowed is an explicit DIAGNOSTICS_LIMIT_EXCEEDED outcome', async () => {
		const limits = { files: 5 };
		const result = fixture.observe(
			await Diagnostics.check({ module: fixture.module('large'), conditions, limits })
		);

		assert.equal(result.complete, false);
		assert.equal(result.outcome.code, 'DIAGNOSTICS_LIMIT_EXCEEDED');
		assert.equal(result.outcome.limit, 'files');
		assert.ok(result.measured.ms > 0);
		return result.outcome.message;
	});

	await step('limits: a check that outlives its time is an explicit DIAGNOSTICS_LIMIT_EXCEEDED outcome', async () => {
		const limits = { ms: 1 };
		const result = fixture.observe(
			await Diagnostics.check({ module: fixture.module('large'), conditions, limits })
		);

		assert.equal(result.complete, false);
		assert.equal(result.outcome.code, 'DIAGNOSTICS_LIMIT_EXCEEDED');
		assert.equal(result.outcome.limit, 'ms');

		const allowed = fixture.observe(
			await Diagnostics.check({ module: fixture.module('large'), conditions, limits: { ms: 60000 } })
		);
		assert.equal(allowed.complete, true);
		assert.equal(allowed.measured.program.sources, 13);
		return `stopped after ${result.measured.ms.toFixed(
			1
		)} ms; the same module completes in ${allowed.measured.ms.toFixed(1)} ms`;
	});

	await step('limits: the time limit stops the type checker in the middle of a source', async () => {
		// One generated source that takes long to check, so the only place the limit can act is inside it
		const chain = Array.from({ length: 900 }, (_, index) => {
			const previous = index ? `step${index - 1}(value)` : '{ ...value }';
			return `export function step${index}<T extends { id: number }>(value: T) {\n\treturn { ...${previous}, field${index}: ${index} };\n}`;
		});
		const sources = { files: { 'heavy/index.ts': `${chain.join('\n')}\n` } };
		const module = fixture.module('heavy');

		const whole = fixture.observe(await Diagnostics.check({ module, conditions, sources }));
		assert.equal(whole.complete, true);

		const { setup, create, check } = whole.measured.program.phases;
		assert.ok(check > 30, `the generated source takes ${check.toFixed(1)} ms to check`);

		const limits = { ms: setup + create + check / 4 };
		const result = fixture.observe(await Diagnostics.check({ module, conditions, sources, limits }));

		assert.equal(result.complete, false);
		assert.equal(result.outcome.code, 'DIAGNOSTICS_LIMIT_EXCEEDED');
		assert.equal(result.outcome.limit, 'ms');
		assert.ok(
			result.measured.program.phases.create > 0,
			'the program was created, so the checker was what stopped'
		);
		assert.ok(result.measured.ms < whole.measured.ms);
		return `whole check ${whole.measured.ms.toFixed(1)} ms; stopped at ${result.measured.ms.toFixed(
			1
		)} ms of ${limits.ms.toFixed(1)} allowed`;
	});

	await step('limits: a cancellation is honored before the check and while it runs', async () => {
		const before = await Diagnostics.check({
			module: fixture.module('large'),
			conditions,
			signal: { aborted: true }
		});
		assert.equal(before.complete, false);
		assert.equal(before.outcome.code, 'DIAGNOSTICS_CANCELLED');

		// The abort is requested from the event loop, which the check only reaches between two sources
		const controller = new AbortController();
		setImmediate(() => controller.abort());
		const during = fixture.observe(
			await Diagnostics.check({ module: fixture.module('large'), conditions, signal: controller.signal })
		);

		assert.equal(during.complete, false);
		assert.equal(during.outcome.code, 'DIAGNOSTICS_CANCELLED');
		assert.ok(during.measured.program.sources > 0, 'the program was created before the cancellation');
		return 'cancelled before the program, and between two sources';
	});

	await step('input: a request that cannot be checked is an outcome, never an exception', async () => {
		const requests = [
			undefined,
			{},
			{ module: fixture.module('clean') },
			{ module: fixture.module('clean', { root: 'relative/root' }), conditions },
			{ module: fixture.module('clean', { entry: 'clean/missing.ts' }), conditions },
			{ module: fixture.module('clean', { entry: '../outside/secret.ts' }), conditions },
			{ module: fixture.module('clean', { files: ['../outside/secret.ts'] }), conditions }
		];

		for (const request of requests) {
			const result = fixture.observe(await Diagnostics.check(request));
			assert.equal(result.complete, false);
			assert.equal(result.outcome.code, 'DIAGNOSTICS_INPUT_INVALID');
			assert.deepEqual(result.diagnostics, []);
		}
		return `${requests.length} invalid requests, each with DIAGNOSTICS_INPUT_INVALID`;
	});

	await step('measured: the duration and the size of the program are reported', async () => {
		const result = fixture.observe(await Diagnostics.check({ module: fixture.module('broken'), conditions }));
		const { ms, files, program } = result.measured;

		assert.ok(ms > 0);
		assert.equal(files, 2);
		assert.equal(program.sources, 2);
		assert.ok(program.libraries > 0);
		assert.match(program.typescript, /^\d+\.\d+\.\d+/);
		assert.ok(program.phases.create > 0 && program.phases.check > 0);
		assert.ok(program.phases.setup + program.phases.create + program.phases.check <= ms);
		return `${ms.toFixed(1)} ms, ${files} files, ${program.libraries} libraries, TypeScript ${program.typescript}`;
	});

	await step('disclosure: no result names an absolute location of the host', async () => {
		const temporary = await realpath(tmpdir());
		const hidden = [fixture.root, await realpath(fixture.root), tmpdir(), temporary, homedir(), process.cwd()];
		const serialized = JSON.stringify(fixture.observed);

		assert.ok(fixture.observed.length >= 20);
		hidden.forEach(location => assert.ok(!serialized.includes(location), `a result names ${location}`));

		// Every reported file is relative to the package, and no message quotes a rooted path
		const reported = fixture.observed.flatMap(({ diagnostics }) => diagnostics);
		reported.forEach(({ file }) => file !== undefined && assert.doesNotMatch(file, /^(\/|[A-Za-z]:)/));
		reported.forEach(({ message }) => assert.doesNotMatch(message, /['"](\/|[A-Za-z]:[\\/])[^'"]*['"]/));
		return `${fixture.observed.length} results, ${reported.length} diagnostics`;
	});
}
