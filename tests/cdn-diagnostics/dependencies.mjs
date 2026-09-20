/**
 * How the types of bare public dependencies reach the check, and what is reported when they do not.
 */
import assert from 'node:assert/strict';
import { Diagnostics } from '@beyond-js/packages/diagnostics';
import { step } from './harness.mjs';

const conditions = { platform: 'node' };

export async function dependencies(fixture) {
	/**
	 * The consumer is correct and the misuse is not, which only the types of the dependency can tell apart
	 */
	const typed = async (supplied, label) => {
		const consumer = fixture.observe(
			await Diagnostics.check({ module: fixture.module('consumer'), conditions, dependencies: supplied })
		);
		assert.equal(consumer.complete, true);
		assert.deepEqual(consumer.diagnostics, []);
		assert.ok(consumer.measured.program.dependencies >= 1);

		const misuse = fixture.observe(
			await Diagnostics.check({ module: fixture.module('misuse'), conditions, dependencies: supplied })
		);
		assert.deepEqual(
			misuse.diagnostics.map(({ code, category, file }) => [code, category, file]),
			[['TS2322', 'semantic', 'misuse/index.ts']]
		);
		assert.match(misuse.diagnostics[0].message, /Type 'Greeting' is not assignable to type 'number'/);
		assert.deepEqual(misuse.summary.unresolved, []);
		return `${label}: consumer clean, misuse TS2322 (Greeting is not a number)`;
	};

	await step('dependencies: a package of Beyond sources supplied by directory types its public module', () =>
		typed({ packages: { '@fixture/shared': fixture.path('shared') } }, 'exports target message/index.ts')
	);

	await step('dependencies: a declaration supplied for a bare specifier types it', () =>
		typed({ declarations: { '@fixture/shared/message': fixture.path('declared/message.d.ts') } }, 'message.d.ts')
	);

	await step('dependencies: a node_modules-like root types a package that ships declarations', async () => {
		const supplied = { roots: [fixture.path('typed/node_modules')] };
		const result = fixture.observe(
			await Diagnostics.check({ module: fixture.module('rooted'), conditions, dependencies: supplied })
		);

		assert.equal(result.complete, true);
		assert.deepEqual(
			result.diagnostics.map(({ code, file }) => [code, file]),
			[['TS2322', 'rooted/index.ts']]
		);
		assert.match(result.diagnostics[0].message, /Type 'number' is not assignable to type 'string'/);
		return 'the number returned by the declared function is not a string';
	});

	await step(
		'dependencies: a compiled package is typed through its exports conditions, patterns and sibling declarations',
		async () => {
			const supplied = { packages: { '@fixture/compiled': fixture.path('store/compiled') } };
			const result = fixture.observe(
				await Diagnostics.check({ module: fixture.module('compiled'), conditions, dependencies: supplied })
			);

			assert.equal(result.complete, true);
			assert.deepEqual(
				result.diagnostics.map(({ code, file }) => [code, file]),
				[['TS2322', 'compiled/index.ts']]
			);
			assert.equal(result.measured.program.dependencies, 2);
			return 'types condition and features/* pattern resolved; the string returned by tool() is not a number';
		}
	);

	await step('dependencies: a public module of the same package is typed from its own sources', async () => {
		const result = fixture.observe(await Diagnostics.check({ module: fixture.module('own'), conditions }));

		assert.equal(result.complete, true);
		assert.deepEqual(
			result.diagnostics.map(({ code, file }) => [code, file]),
			[['TS2322', 'own/index.ts']]
		);
		assert.match(result.diagnostics[0].message, /Type 'string' is not assignable to type 'number'/);
		return '@fixture/app/clean resolved through the exports of the package being checked';
	});

	await step(
		'dependencies: without declarations the dependency is types-unresolved, not an error of the module',
		async () => {
			for (const name of ['consumer', 'misuse']) {
				const result = fixture.observe(await Diagnostics.check({ module: fixture.module(name), conditions }));

				assert.equal(result.complete, true);
				assert.equal(result.diagnostics.length, 1);
				assert.deepEqual(result.summary, {
					errors: 0,
					warnings: 1,
					unresolved: ['@fixture/shared/message'],
					withheld: 0,
					truncated: false
				});

				const [unresolved] = result.diagnostics;
				assert.equal(unresolved.category, 'types-unresolved');
				assert.equal(unresolved.code, 'TYPES_UNRESOLVED');
				assert.equal(unresolved.origin, 'TS2307');
				assert.equal(unresolved.severity, 'warning');
				assert.equal(unresolved.specifier, '@fixture/shared/message');
				assert.equal(unresolved.file, `${name}/index.ts`);
			}
			return 'one warning per module, 0 errors, no false TS2322';
		}
	);

	await step(
		'dependencies: an implicit any is an error, and is withheld while missing types could explain it',
		async () => {
			const typed = { packages: { '@fixture/shared': fixture.path('shared') } };
			const known = fixture.observe(
				await Diagnostics.check({ module: fixture.module('derived'), conditions, dependencies: typed })
			);
			assert.deepEqual(
				known.diagnostics.map(({ code, file }) => [code, file]),
				[['TS7006', 'derived/index.ts']]
			);
			assert.equal(known.summary.withheld, 0);

			// Without the types, the parameter of the callback is an implicit any as well, only as a consequence
			const result = fixture.observe(await Diagnostics.check({ module: fixture.module('derived'), conditions }));
			assert.equal(result.complete, true);
			assert.deepEqual(
				result.diagnostics.map(({ category }) => category),
				['types-unresolved']
			);
			assert.equal(result.summary.errors, 0);
			assert.equal(result.summary.withheld, 2);
			return 'typed: 1 genuine TS7006; untyped: 1 warning, 2 implicit-any reports withheld, 0 errors';
		}
	);

	await step('dependencies: missing platform types do not become a storm of semantic errors', async () => {
		const result = fixture.observe(await Diagnostics.check({ module: fixture.module('platform'), conditions }));

		assert.equal(result.complete, true);
		assert.equal(result.summary.errors, 0);
		assert.ok(result.diagnostics.length > 0);
		assert.ok(result.diagnostics.every(({ category }) => category === 'types-unresolved'));
		assert.deepEqual(result.summary.unresolved, ['node:fs', 'path']);

		// Each missing global is reported once, with how many times it was used
		const process = result.diagnostics.find(({ message }) => message.includes(`'process'`));
		assert.equal(process.occurrences, 2);
		return `${result.diagnostics.length} warnings: ${result.diagnostics.map(({ origin }) => origin).join(', ')}`;
	});

	await step('dependencies: a location outside the package and the supplied dependencies is never read', async () => {
		const result = fixture.observe(await Diagnostics.check({ module: fixture.module('escape'), conditions }));

		// With the file readable, the only diagnostic would be TS2322: the secret is a string, not a number
		assert.equal(result.complete, true);
		assert.deepEqual(
			result.diagnostics.map(({ code, category }) => [code, category]),
			[['TS2307', 'semantic']]
		);
		assert.equal(result.measured.program.dependencies, 0);
		return 'the relative import is a missing source (TS2307), its content was not loaded';
	});
}
