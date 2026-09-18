/**
 * The authoring forms a package can use to declare its public modules. Each form is built and executed on
 * its own, because a fixture that combines them (as the suite testbed does) proves none of them separately.
 *
 * The manifests written here are the complete minimal configuration of each form: they are the examples the
 * Packages documentation refers to.
 */
import assert from 'node:assert/strict';
import { step } from '../stage-1/harness.mjs';
import { Fixture, bundlers } from './fixtures.mjs';
import { Build } from './runner.mjs';

const source = text => `export const form = '${text}';\nexport default () => 'default of ${text}';\n`;

/**
 * Builds a single-package workspace and executes one of its public modules
 */
async function single(name, files, specifier) {
	const fixture = await Fixture.create(name, { 'beyond.json': { packages: ['.'] }, ...files });
	try {
		const build = new Build(fixture);
		await build.run();
		const execution = specifier ? await build.execute(specifier) : void 0;
		return { build, execution };
	} finally {
		await fixture.destroy();
	}
}

const forms = [
	{
		name: 'exports-only',
		notes: 'no manifest and no platforms: one platform-neutral conditional satisfies the node request',
		specifier: 'form-exports/greet',
		files: {
			'package.json': {
				name: 'form-exports',
				version: '1.0.0',
				exports: { './greet': './greet/index.ts' },
				beyond: { bundler: 'ts' },
				bundlers
			},
			'greet/index.ts': source('exports-only')
		}
	},
	{
		name: 'manifest-only',
		notes: 'no exports: the manifest is discovered under beyond.modules and names its entry point',
		specifier: 'form-manifest/greet',
		files: {
			'package.json': { name: 'form-manifest', version: '1.0.0', beyond: { modules: '.', bundler: 'ts' }, bundlers },
			'greet/module.json': { entry: 'index.ts', platforms: ['node'] },
			'greet/index.ts': source('manifest-only')
		}
	},
	{
		name: 'combined',
		notes: 'exports locate the entry point, the manifest adds the platforms and selects the bundler',
		specifier: '@form/combined/utils/greet',
		files: {
			'package.json': {
				name: '@form/combined',
				version: '1.0.0',
				exports: { './utils/greet': './utils/greet/index.ts' },
				beyond: { modules: '.' },
				bundlers
			},
			'utils/greet/module.json': { bundler: 'ts', platforms: ['node'] },
			'utils/greet/index.ts': source('combined')
		}
	},
	{
		name: 'root-exports',
		notes: 'the "." subpath publishes the package name itself',
		specifier: '@form/root',
		files: {
			'package.json': {
				name: '@form/root',
				version: '1.0.0',
				exports: { '.': './src/index.ts' },
				beyond: { bundler: 'ts' },
				bundlers
			},
			'src/index.ts': source('root-exports')
		}
	},
	{
		name: 'root-string',
		notes: 'a string is the shorthand of the root entry',
		specifier: 'form-string',
		files: {
			'package.json': { name: 'form-string', version: '1.0.0', exports: './src/index.ts', beyond: { bundler: 'ts' }, bundlers },
			'src/index.ts': source('root-string')
		}
	},
	{
		name: 'root-main',
		notes: 'without exports, a source-valued main publishes the root',
		specifier: 'form-main',
		files: {
			'package.json': { name: 'form-main', version: '1.0.0', main: 'src/index.ts', beyond: { bundler: 'ts' }, bundlers },
			'src/index.ts': source('root-main')
		}
	}
];

const unsupported = [
	{ name: 'root conditions', exports: { import: './src/index.ts' }, code: 'EXPORTS_UNSUPPORTED' },
	{ name: 'subpath pattern', exports: { './*': './src/*.ts' }, code: 'EXPORTS_UNSUPPORTED' },
	{ name: 'fallback array', exports: ['./src/index.ts'], code: 'EXPORTS_UNSUPPORTED' }
];

export async function declarations() {
	for (const { name, notes, specifier, files } of forms) {
		await step(`declaration form: ${name} builds and executes`, async () => {
			const { build, execution } = await single(name, files, specifier);
			assert.deepEqual(build.report.errors, []);
			assert.ok(build.artifact(specifier), `artifact of ${specifier}`);
			assert.equal(execution.code, 0, execution.stderr);
			assert.deepEqual(execution.values, { default: `default of ${name}`, form: name });
			return notes;
		});
	}

	await step('declaration precedence: exports define the published root, main does not restore it', async () => {
		const files = {
			'package.json': {
				name: 'form-precedence',
				version: '1.0.0',
				main: 'src/index.ts',
				exports: { './other': './other/index.ts' },
				beyond: { bundler: 'ts' },
				bundlers
			},
			'src/index.ts': source('main'),
			'other/index.ts': source('other')
		};
		const { build } = await single('precedence', files);
		assert.deepEqual(build.report.artifacts.map(one => one.specifier), ['form-precedence/other']);
		return 'only form-precedence/other is published';
	});

	await step('declaration forms: a main that is not a source file publishes no root, with a warning', async () => {
		const files = {
			'package.json': { name: 'form-dist', version: '1.0.0', main: 'dist/index.json', beyond: { bundler: 'ts' }, bundlers }
		};
		const { build } = await single('dist', files);
		assert.deepEqual(build.report.artifacts, []);
		assert.ok(build.report.warnings.some(one => one.code === 'MAIN_NOT_SOURCE'), JSON.stringify(build.report.warnings));
		return 'MAIN_NOT_SOURCE';
	});

	for (const { name, exports, code } of unsupported) {
		await step(`declaration forms: ${name} in exports are rejected explicitly`, async () => {
			const files = {
				'package.json': { name: 'form-unsupported', version: '1.0.0', exports, beyond: { bundler: 'ts' }, bundlers },
				'src/index.ts': source('unsupported')
			};
			const { build } = await single('unsupported', files);
			assert.deepEqual(build.report.artifacts, []);
			assert.ok(build.report.errors.some(one => one.code === code), JSON.stringify(build.report));
			return code;
		});
	}

	await step('declaration forms: a manifest-only module without an entry point is reported', async () => {
		const files = {
			'package.json': { name: 'form-noentry', version: '1.0.0', beyond: { modules: '.', bundler: 'ts' }, bundlers },
			'greet/module.json': { platforms: ['node'] },
			'greet/index.ts': source('no entry')
		};
		const { build } = await single('noentry', files);
		assert.deepEqual(build.report.artifacts, []);
		assert.ok(build.codes().includes('MODULE_ENTRY_MISSING'), JSON.stringify(build.report.errors));
		return 'MODULE_ENTRY_MISSING';
	});

	await step('declaration forms: a package that registers no bundlers is told how to register one', async () => {
		const files = {
			'package.json': { name: 'form-noregistry', version: '1.0.0', exports: { './greet': './greet/index.ts' } },
			'greet/index.ts': source('no registry')
		};
		const { build } = await single('noregistry', files);
		assert.deepEqual(build.report.artifacts, []);
		assert.match(JSON.stringify(build.report), /registers no bundlers/);
		return 'BUNDLERS_NOT_REGISTERED explained';
	});

	await step('declaration forms: no selected bundler is reported, not guessed', async () => {
		const files = {
			'package.json': { name: 'form-nobundler', version: '1.0.0', exports: { './greet': './greet/index.ts' }, bundlers },
			'greet/index.ts': source('no bundler')
		};
		const { build } = await single('nobundler', files);
		assert.deepEqual(build.report.artifacts, []);
		// The resolver diagnostic is reported through the module that could not be resolved
		const warning = build.report.warnings.find(one => one.code === 'INVALID_RESOLVER');
		assert.match(warning?.message ?? '', /does not select a bundler/);
		return 'INVALID_RESOLVER: does not select a bundler';
	});
}
