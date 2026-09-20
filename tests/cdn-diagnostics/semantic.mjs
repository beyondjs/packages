/**
 * What the type checker reports that a per-file transformation cannot: the same sources are given to the
 * transformation generation uses and to the semantic check, and the two answers are compared.
 */
import assert from 'node:assert/strict';
import ts from 'typescript';
import { Diagnostics } from '@beyond-js/packages/diagnostics';
import { position, step } from './harness.mjs';

const conditions = { platform: 'node' };

/**
 * The per-file transformation of the TypeScript processor of Packages, with the options it uses
 */
const transpile = (source, fileName) =>
	ts.transpileModule(source, {
		fileName,
		reportDiagnostics: true,
		compilerOptions: {
			module: ts.ModuleKind.CommonJS,
			target: ts.ScriptTarget.ES2022,
			isolatedModules: true,
			sourceMap: true
		}
	});

export async function semantic(fixture) {
	await step('semantic: transpilation accepts a wrong value type and a wrong cross-file call', async () => {
		const index = transpile(fixture.source('app/broken/index.ts'), 'broken/index.ts');
		const geometry = transpile(fixture.source('app/broken/geometry.ts'), 'broken/geometry.ts');

		assert.equal(index.diagnostics.length, 0);
		assert.equal(geometry.diagnostics.length, 0);
		assert.match(index.outputText, /exports\.size = 'text'/);
		return 'ts.transpileModule: 0 diagnostics, code emitted';
	});

	await step('semantic: the check reports TS2322 and TS2345 with package-relative file and range', async () => {
		const result = fixture.observe(await Diagnostics.check({ module: fixture.module('broken'), conditions }));
		const source = fixture.source('app/broken/index.ts');

		assert.equal(result.complete, true);
		assert.equal(result.outcome, undefined);
		assert.deepEqual(result.diagnostics.map(({ code }) => code).sort(), ['TS2322', 'TS2345']);
		assert.deepEqual(result.summary, { errors: 2, warnings: 0, unresolved: [], withheld: 0, truncated: false });

		const assigned = result.diagnostics.find(({ code }) => code === 'TS2322');
		assert.equal(assigned.category, 'semantic');
		assert.equal(assigned.severity, 'error');
		assert.equal(assigned.file, 'broken/index.ts');
		assert.match(assigned.message, /Type 'string' is not assignable to type 'number'/);
		assert.deepEqual(assigned.range, { start: position(source, 'size'), end: position(source, 'size', 4) });

		const called = result.diagnostics.find(({ code }) => code === 'TS2345');
		assert.equal(called.category, 'semantic');
		assert.equal(called.file, 'broken/index.ts');
		assert.match(called.message, /Argument of type 'string' is not assignable to parameter of type 'number'/);
		assert.deepEqual(called.range, { start: position(source, `'3'`), end: position(source, `'3'`, 3) });

		const { line, character } = assigned.range.start;
		return `TS2322 at broken/index.ts ${line}:${character}, TS2345 at ${called.range.start.line}:${called.range.start.character}`;
	});

	await step('semantic: a clean module has no diagnostics', async () => {
		const result = fixture.observe(await Diagnostics.check({ module: fixture.module('clean'), conditions }));

		assert.equal(result.complete, true);
		assert.deepEqual(result.diagnostics, []);
		assert.deepEqual(result.summary, { errors: 0, warnings: 0, unresolved: [], withheld: 0, truncated: false });
		assert.equal(result.measured.program.sources, 2);
		assert.equal(result.measured.program.strict, true);
		assert.equal(result.measured.program.configuration, 'defaults');
		return `${result.measured.program.sources} sources, strict defaults`;
	});

	await step('semantic: a syntax error is reported by transpilation and by the check', async () => {
		const transpiled = transpile(fixture.source('app/syntax/index.ts'), 'syntax/index.ts');
		assert.ok(transpiled.diagnostics.length > 0);

		const result = fixture.observe(await Diagnostics.check({ module: fixture.module('syntax'), conditions }));
		const syntactic = result.diagnostics.filter(({ category }) => category === 'syntactic');

		assert.equal(result.complete, true);
		assert.ok(syntactic.length > 0);
		assert.ok(result.summary.errors >= syntactic.length);

		const codes = transpiled.diagnostics.map(({ code }) => `TS${code}`);
		codes.forEach(code =>
			assert.ok(
				syntactic.some(one => one.code === code),
				`${code} is reported by the check`
			)
		);
		syntactic.forEach(one => assert.equal(one.file, 'syntax/index.ts'));
		assert.ok(syntactic[0].range.start.line >= 0);
		return `transpilation ${codes.join(', ')}; check ${syntactic.map(({ code }) => code).join(', ')}`;
	});

	await step('semantic: sources supplied in memory replace those of the package', async () => {
		const sources = {
			files: {
				'clean/format.ts': 'export function format(subject: number): string {\n\treturn `${subject}`;\n}\n'
			}
		};
		const result = fixture.observe(
			await Diagnostics.check({ module: fixture.module('clean'), conditions, sources })
		);

		assert.equal(result.complete, true);
		assert.deepEqual(
			result.diagnostics.map(({ code, file }) => [code, file]),
			[['TS2345', 'clean/index.ts']]
		);
		return 'the edited signature is what the entry point is checked against';
	});

	await step(
		'semantic: the declared configuration owns the strictness, and its problems are options diagnostics',
		async () => {
			const loose = fixture.module('clean', { tsconfig: { compilerOptions: { strict: false } } });
			const relaxed = fixture.observe(await Diagnostics.check({ module: loose, conditions }));
			assert.equal(relaxed.measured.program.configuration, 'inline');
			assert.equal(relaxed.measured.program.strict, false);

			const result = fixture.observe(
				await Diagnostics.check({ module: fixture.module('configured'), conditions })
			);
			const options = result.diagnostics.filter(({ category }) => category === 'options');

			assert.equal(result.complete, true);
			assert.equal(result.measured.program.configuration, 'configured/tsconfig.json');
			assert.ok(options.length > 0);
			assert.ok(options.every(one => !one.message.includes(fixture.root)));
			return `${options.map(({ code }) => code).join(', ')}: ${options[0].message}`;
		}
	);
}
