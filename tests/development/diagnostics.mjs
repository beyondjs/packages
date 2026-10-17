/**
 * The located diagnostics of a build, over a stand-in delivery whose answers name the problems the real compilers
 * report: one syntax error that the transformation and the type check both report, and that two public modules
 * meet, is listed once with the lines around it; a type error of a package the toolchain supplies is not reported
 * against the workspace's build; and a build names the files whose changes it compiled.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { revision, step } from './harness.mjs';
import { serve, until } from './service.mjs';

const BROKEN = 'export const v = ;';
const SUPPLIED = '@beyond-js/widgets@1.1.5/application';

/**
 * Two public modules of the workspace that compile one file, and a module of a supplied package whose declaration
 * reports a type error in a file outside the root, as the toolchain's own defects were reported
 */
class Delivery {
	constructor(project) {
		this.project = project;
	}

	get #file() {
		return this.project.file('app/main/index.ts');
	}

	async published() {
		return [
			{ vspecifier: '@case/app@1.0.0/main', name: '@case/app', version: '1.0.0', subpath: './main' },
			{ vspecifier: '@case/app@1.0.0/other', name: '@case/app', version: '1.0.0', subpath: './other' },
			{ vspecifier: SUPPLIED, name: '@beyond-js/widgets', version: '1.1.5', subpath: './application', supplied: true }
		];
	}

	#broken() {
		return readFileSync(this.#file, 'utf8').includes('= ;');
	}

	#syntax(code) {
		return { code, message: 'index.ts (1:18): Expression expected.', file: this.#file, position: { line: 1, column: 18 } };
	}

	async module({ vspecifier }) {
		if (vspecifier !== SUPPLIED && this.#broken()) return { failure: { code: 'BUILD_FAILED', message: 'failed', diagnostics: [this.#syntax('TRANSPILE_ERROR')] } };
		return { delivered: { hash: revision(vspecifier).slice(7, 15), dependencies: [], runtime: '@beyond-js/kernel/bundle' } };
	}

	async declaration({ vspecifier }) {
		if (vspecifier === SUPPLIED) {
			const file = join(tmpdir(), 'toolchain/widgets/modules/application/index.ts');
			const diagnostics = [{ code: 'TS2305', message: "Module '\"@beyond-js/kernel/routing\"' has no exported member 'IRoutingSettings'.", file, position: { line: 1, column: 24 } }];
			return { failure: { code: 'BUILD_FAILED', message: 'does not check', diagnostics } };
		}
		if (this.#broken()) return { failure: { code: 'BUILD_FAILED', message: 'failed', diagnostics: [this.#syntax('TS1109')] } };
		return { declaration: { vspecifier, hash: `dts${revision(vspecifier).slice(7, 12)}`, code: `declare module "${vspecifier}" {}\n` } };
	}
}

export async function diagnostics() {
	await step('diagnostics: one problem is listed once with its frame, a supplied package is not reported, and a build names its files (stub delivery)', async () => {
		const context = await serve({ 'app/main/index.ts': 'export const v = 1;\nexport const w = 2;\n' }, void 0, void 0, Delivery);
		const events = [];
		context.development.files.log.subscribe(event => events.push(event));
		const ended = () => events.filter(({ type }) => type === 'build.ended').map(({ build }) => build);
		const source = () => revision(readFileSync(context.project.file('app/main/index.ts')));

		const first = (await context.call('POST', '/builds')).body;
		await until(() => ended().some(({ id }) => id === first.id), 'the first build');
		const clean = ended().find(({ id }) => id === first.id);
		assert.deepEqual([clean.state, clean.diagnostics, clean.files], ['completed', void 0, void 0], 'the supplied package\'s type error is the toolchain\'s');

		await context.call('PUT', '/files/content/app/main/index.ts', { body: `${BROKEN}\nexport const w = 2;\n`, headers: { 'if-match': `"${source()}"` } });
		await until(() => ended().length >= 2, 'the build after the edit');
		const failed = ended().at(-1);
		assert.equal(failed.state, 'failed');
		assert.deepEqual(failed.files, ['app/main/index.ts']);
		assert.equal(failed.diagnostics.length, 1, JSON.stringify(failed.diagnostics));

		const [problem] = failed.diagnostics;
		assert.deepEqual(
			[problem.code, problem.severity, problem.file, problem.range, problem.modules],
			['TRANSPILE_ERROR', 'error', 'app/main/index.ts', { line: 1, column: 18 }, ['@case/app@1.0.0/other']],
			'the transformation\'s code, and the other module that met it'
		);
		assert.ok(problem.message.startsWith('@case/app@1.0.0/main: '));
		assert.deepEqual(problem.frame, { line: 1, column: 18, lines: [{ number: 1, text: BROKEN }, { number: 2, text: 'export const w = 2;' }] });
		assert.ok(!failed.diagnostics.some(({ code }) => code === 'TS2305'));

		await context.call('PUT', '/files/content/app/main/index.ts', { body: 'export const v = 3;\n', headers: { 'if-match': `"${source()}"` } });
		await until(() => ended().length >= 3, 'the recovery build');
		assert.deepEqual([ended().at(-1).state, ended().at(-1).diagnostics], ['completed', void 0]);
		context.stop();
	});
}
