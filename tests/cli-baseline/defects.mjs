/**
 * The three defects recorded by the source review of 2026-09-18, each checked on what a consumer can reach:
 * the value of a default export, and the files and import map entries left by a build that failed.
 *
 * The dependency cases copy the workspace `fixtures/defects`: `@case/app/main` imports `@case/shared/value`
 * and declares the dependency. The single-package cases are small inputs written by their checks.
 */
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { step } from '../stage-1/harness.mjs';
import { Fixture, manifest } from './fixtures.mjs';
import { Build } from './runner.mjs';

// The modules declare their platform, so these cases do not depend on the platform-neutral mapping
const node = { platforms: ['node'] };

export async function defects() {
	await step('default export: a consumer reads the exported value, not an unassigned binding', async () => {
		const fixture = await Fixture.create('default', {
			'beyond.json': { packages: ['pkg'] },
			'pkg/package.json': manifest('@case/pkg', { exports: { './answer': './answer/index.ts' } }),
			'pkg/answer/module.json': node,
			'pkg/answer/index.ts': `export default function answer() {\n\treturn 42;\n}\nexport const named = 'named value';\n`
		});

		try {
			const build = new Build(fixture);
			await build.run();
			assert.deepEqual(build.codes(), []);
			assert.deepEqual(build.artifact('@case/pkg/answer').exports, ['default', 'named']);

			const { code, values, stderr } = await build.execute('@case/pkg/answer');
			assert.equal(code, 0, stderr);
			assert.deepEqual(values, { default: 42, named: 'named value' }, 'the alias must not leak as "_default"');
			return 'default() = 42; public names: default, named';
		} finally {
			await fixture.destroy();
		}
	});

	await step('export names: exports named as the update closure parameters keep their values', async () => {
		const fixture = await Fixture.create('names', {
			'beyond.json': { packages: ['pkg'] },
			'pkg/package.json': manifest('@case/pkg', { exports: { './names': './names/index.ts', './reserved': './reserved/index.ts' } }),
			'pkg/names/module.json': node,
			'pkg/names/index.ts': `export const value = 'v';\nexport const prop = 'p';\nexport const require = 'r';\nexport const ims = 'i';\n`,
			'pkg/reserved/module.json': node,
			'pkg/reserved/index.ts': `export const hmr = 'not the runtime handle';\n`
		});

		try {
			const build = new Build(fixture);
			await build.run();
			assert.deepEqual(build.codes(), ['EXPORT_RESERVED'], JSON.stringify(build.report.errors));
			assert.match(build.report.errors[0].message, /"hmr"/);

			const { code, values, stderr } = await build.execute('@case/pkg/names');
			assert.equal(code, 0, stderr);
			assert.deepEqual(values, { ims: 'i', prop: 'p', require: 'r', value: 'v' });
			return 'value/prop/require/ims exported correctly; "hmr" rejected as EXPORT_RESERVED';
		} finally {
			await fixture.destroy();
		}
	});

	await step('dependency error: the dependent artifact is neither written nor mapped', async () => {
		const fixture = await Fixture.copy('undeclared', 'defects');
		// The one substitution of this case: the application no longer declares the package it imports
		const application = fixture.path('app/package.json');
		const { dependencies, ...undeclared } = JSON.parse(await readFile(application, 'utf8'));
		await writeFile(application, JSON.stringify(undeclared, null, '\t'));

		try {
			const build = new Build(fixture);
			await build.run();
			assert.ok(build.codes().includes('DEPENDENCY_NOT_DECLARED'), JSON.stringify(build.report.errors));

			assert.equal(build.artifact('@case/app/main'), undefined, 'not reported as an artifact');
			assert.equal((await build.importmap())['@case/app/main'], undefined, 'not resolvable');
			assert.equal(await build.exists('@case/app@1.0.0/main.node.mjs'), false, 'not reachable as a file');

			// The module it depends on is unaffected
			assert.ok(build.artifact('@case/shared/value'));
			const { code } = await build.execute('@case/app/main');
			assert.notEqual(code, 0, 'a consumer cannot execute the invalid module');
			return 'DEPENDENCY_NOT_DECLARED; no file, no import map entry, consumer fails';
		} finally {
			await fixture.destroy();
		}
	});

	await step('failed rebuild: the previous artifact files do not remain reachable', async () => {
		const fixture = await Fixture.copy('stale', 'defects');

		try {
			const build = new Build(fixture);
			await build.run();
			assert.deepEqual(build.codes(), []);
			const files = ['main.node.mjs', 'main.node.mjs.map', 'main.node.hmr.mjs'].map(file => `@case/app@1.0.0/${file}`);
			for (const file of files) assert.equal(await build.exists(file), true, file);
			assert.deepEqual((await build.execute('@case/app/main')).values, { main: 'app: shared value' });

			await fixture.write({ 'app/main/index.ts': `export const main = () => 'unterminated;\n` });
			await build.run();
			assert.ok(build.codes().includes('TRANSPILE_ERROR'), JSON.stringify(build.report.errors));
			for (const file of files) assert.equal(await build.exists(file), false, `stale ${file}`);
			assert.equal((await build.importmap())['@case/app/main'], undefined);
			assert.equal(await build.exists('@case/shared@1.0.0/value.node.mjs'), true, 'unrelated artifact kept');

			// A module that is no longer declared does not leave its artifact behind either
			await fixture.write({
				'app/package.json': manifest('@case/app', { exports: {}, dependencies: { '@case/shared': '1.0.0' } })
			});
			await build.run();
			for (const file of files) assert.equal(await build.exists(file), false, `undeclared ${file}`);

			await fixture.restore('app');
			await build.run();
			assert.deepEqual(build.codes(), []);
			assert.deepEqual((await build.execute('@case/app/main')).values, { main: 'app: shared value' });
			return 'failed build removed 3 files and the map entry; recovery restored execution';
		} finally {
			await fixture.destroy();
		}
	});
}
