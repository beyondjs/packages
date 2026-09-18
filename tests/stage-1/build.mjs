/**
 * What Packages produces from the fixture, before anything executes it: which modules it discovers, which
 * bundler and conditions it selects, what the artifacts contain, and how the dependencies between the two
 * packages are resolved. Each behavior is also checked in the negative, on a temporary copy of the fixture.
 */
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Workspace } from '@beyond-js/packages/workspace';
import { Artifacts } from '@beyond-js/packages/artifacts';
import { artifactsPath, conditions, json, step, testbed, variant } from './harness.mjs';

/**
 * @param context The workspace, its artifacts writer and the report holder shared by the whole run
 */
export async function build(context) {
	const { workspace, artifacts } = context;

	await step('discovery: both packages and their exact public modules', async () => {
		await workspace.ready;
		assert.deepEqual(workspace.errors, []);
		assert.deepEqual([...workspace.packages.keys()], ['shared', 'app']);

		for (const pkg of workspace.packages.values()) {
			await pkg.ready;
			assert.equal(pkg.valid, true, JSON.stringify(pkg.errors));
			await pkg.modules.ready;
			assert.deepEqual(pkg.modules.errors, []);
			assert.deepEqual(pkg.modules.warnings, []);
		}

		const shared = workspace.packages.get('shared');
		const app = workspace.packages.get('app');
		assert.equal(shared.name, '@suite/shared');
		assert.equal(app.name, '@suite/app');

		// The public modules are the ones the packages declare, not one per source directory
		assert.deepEqual([...shared.modules.keys()], ['./message']);
		assert.deepEqual([...app.modules.keys()], ['./main']);
		assert.equal(shared.watcher?.started, true, 'package watcher started');
		return 'shared: ./message, app: ./main';
	});

	await step('bundler selection: manifest selection and package default bundler', async () => {
		const message = workspace.packages.get('shared').modules.get('./message');
		const main = workspace.packages.get('app').modules.get('./main');

		// The manifest of shared/message selects no bundler: the default of the package applies
		assert.equal(message.spec.bundler, 'ts');
		assert.equal(message.spec.entry, 'index.ts');
		assert.equal(message.spec.path, 'message');

		// The manifest of app/main selects it explicitly
		assert.equal(main.spec.bundler, 'ts');
		assert.equal(main.bundler.specifier, '@beyond-js/packages/bundlers/ts');
		return 'both resolved to @beyond-js/packages/bundlers/ts';
	});

	await step('conditions: declared platforms produce the conditionals', async () => {
		const message = workspace.packages.get('shared').modules.get('./message');
		const main = workspace.packages.get('app').modules.get('./main');
		await message.conditionals.ready;
		await main.conditionals.ready;

		assert.deepEqual([...message.conditionals.keys()], ['node', 'web']);
		assert.deepEqual([...main.conditionals.keys()], ['node']);
		return 'shared: node, web; app: node';
	});

	await step('readiness: an unregistered bundler alias is a deterministic diagnostic', async () => {
		const report = await variant('alias', async root => {
			await json(join(root, 'app/main/module.json'), value => (value.bundler = 'nope'));
		});

		const reported = report.warnings.some(one => one.code === 'INVALID_RESOLVER' && /"nope"/.test(one.message));
		assert.ok(reported, JSON.stringify(report.warnings));
		assert.ok(!report.artifacts.some(one => one.specifier === '@suite/app/main'));
		return 'INVALID_RESOLVER (BUNDLER_NOT_FOUND) for @suite/app/main';
	});

	await step(
		'readiness: a bundler whose implementation cannot be imported is a deterministic diagnostic',
		async () => {
			const report = await variant('import', async root => {
				await json(join(root, 'app/package.json'), value => {
					value.bundlers.ts = '@beyond-js/packages/bundlers/does-not-exist';
				});
			});

			// Awaiting the bundler is part of resolving the module: the failure is reported, not a missing module
			const pattern = /BUNDLER_IMPORT_ERROR|Error importing bundler/;
			const reported = report.warnings.some(one => one.code === 'INVALID_RESOLVER' && pattern.test(one.message));
			assert.ok(reported, JSON.stringify(report.warnings));
			return 'INVALID_RESOLVER (BUNDLER_IMPORT_ERROR)';
		}
	);

	await step('declarations: a manifest conflicting with the exports entry is rejected', async () => {
		const report = await variant('conflict', async root => {
			await json(join(root, 'shared/package.json'), value => (value.exports['./message'] = './other/index.ts'));
		});

		assert.ok(
			report.errors.some(one => one.code === 'MODULE_ENTRY_CONFLICT'),
			JSON.stringify(report.errors)
		);
		return 'MODULE_ENTRY_CONFLICT';
	});

	await step('declarations: a package composes its own public modules by bare reference', async () => {
		const report = await variant('same-package', async root => {
			await json(join(root, 'shared/package.json'), value => (value.exports['./tagline'] = './tagline/index.ts'));
			await mkdir(join(root, 'shared/tagline'));
			await writeFile(
				join(root, 'shared/tagline/module.json'),
				JSON.stringify({ platforms: ['node'] }, null, '\t')
			);
			await writeFile(
				join(root, 'shared/tagline/index.ts'),
				"import { greet } from '@suite/shared/message';\n\nexport const tagline = greet('Beyond');\n"
			);
		});

		assert.deepEqual(report.errors, [], JSON.stringify(report.errors));

		// A public module of the same package needs no declared dependency: a package does not depend on itself
		const tagline = report.artifacts.find(one => one.specifier === '@suite/shared/tagline');
		assert.ok(tagline, 'the module declared by the new exports entry is built');
		assert.deepEqual(tagline.exports, ['tagline']);
		assert.equal(tagline.dependencies.length, 1);
		assert.equal(tagline.dependencies[0].specifier, '@suite/shared/message');
		assert.equal(tagline.dependencies[0].source, 'workspace');
		assert.equal(tagline.dependencies[0].vspecifier, '@suite/shared@0.1.0/message');
		assert.equal(tagline.dependencies[0].range, undefined);
		return '@suite/shared/tagline resolves @suite/shared/message without a declared range';
	});

	await step('artifacts: real, separate, source-derived output with preserved bare references', async () => {
		const report = (context.report = await artifacts.build());
		assert.deepEqual(report.errors, [], JSON.stringify(report.errors));
		assert.deepEqual(report.artifacts.map(one => one.specifier).sort(), [
			'@suite/app/main',
			'@suite/shared/message'
		]);

		const shared = context.artifact('@suite/shared/message');
		const app = context.artifact('@suite/app/main');
		assert.equal(shared.vspecifier, '@suite/shared@0.1.0/message');
		assert.equal(app.vspecifier, '@suite/app@0.1.0/main');

		// The public API is what the entry point exports; every source of the module is an internal module
		assert.deepEqual(shared.exports, ['greet', 'message']);
		assert.deepEqual(app.exports, ['custom', 'main']);
		assert.deepEqual(
			shared.ims.map(im => im.id),
			['./format', './index', './instrumentation']
		);
		assert.deepEqual(
			app.ims.map(im => im.id),
			['./decorate', './index']
		);

		const code = await readFile(join(artifactsPath, app.file), 'utf8');
		assert.match(
			code,
			/^import \* as dependency_\d+ from '@suite\/shared\/message';$/m,
			'bare public import preserved'
		);
		assert.match(code, /^import \* as dependency_0 from '@beyond-js\/kernel\/bundle';$/m);
		assert.doesNotMatch(code, /INTERNAL MODULE: \.\/format/, 'shared internals are not inlined into the app');
		assert.match(code, /^export let custom, main;$/m);
		assert.doesNotMatch(code, /export let[^\n]*(decorate|separator)/, 'internal-only exports are hidden');
		assert.deepEqual(app.dependencies, [
			{
				specifier: '@suite/shared/message',
				source: 'workspace',
				vspecifier: '@suite/shared@0.1.0/message',
				range: '0.1.0'
			}
		]);

		const importmap = JSON.parse(await readFile(join(artifactsPath, report.importmap), 'utf8'));
		assert.equal(importmap.imports['@suite/app/main'], `./${app.file}`);
		assert.equal(importmap.imports['@suite/shared/message'], `./${shared.file}`);
		return `${app.file} (${app.hash.slice(0, 8)}), ${shared.file} (${shared.hash.slice(0, 8)})`;
	});

	await step('cross-package: an undeclared workspace dependency fails clearly', async () => {
		const report = await variant('undeclared', async root => {
			await json(join(root, 'app/package.json'), value => delete value.dependencies);
		});

		assert.ok(
			report.errors.some(one => one.code === 'DEPENDENCY_NOT_DECLARED'),
			JSON.stringify(report.errors)
		);
		return 'DEPENDENCY_NOT_DECLARED';
	});

	await step('cross-package: an incompatible version range fails clearly', async () => {
		const report = await variant('incompatible', async root => {
			await json(join(root, 'app/package.json'), value => (value.dependencies['@suite/shared'] = '^2.0.0'));
		});

		assert.ok(
			report.errors.some(one => one.code === 'DEPENDENCY_INCOMPATIBLE'),
			JSON.stringify(report.errors)
		);
		return 'DEPENDENCY_INCOMPATIBLE';
	});

	await step('cross-package: a missing public module of a workspace package fails clearly', async () => {
		const report = await variant('missing', async root => {
			const file = join(root, 'app/main/index.ts');
			const source = await readFile(file, 'utf8');

			// Every mention, so that the import is the one rewritten whatever else names the module
			await writeFile(file, source.replaceAll('@suite/shared/message', '@suite/shared/absent'));
		});

		assert.ok(
			report.errors.some(one => one.code === 'MODULE_NOT_FOUND'),
			JSON.stringify(report.errors)
		);
		return 'MODULE_NOT_FOUND';
	});

	await step('conditions: an undeclared platform of a module fails clearly', async () => {
		const path = join(tmpdir(), 'beyond-stage1-web');
		const ws = new Workspace(testbed);
		const web = new Artifacts(ws, { path, conditions: { platform: 'web' } });
		const report = await web.build();
		ws.destroy();
		await rm(path, { recursive: true, force: true });

		const reported = report.errors.some(
			one => one.code === 'CONDITIONAL_NOT_FOUND' && /@suite\/app\/main/.test(one.message)
		);
		assert.ok(reported, JSON.stringify(report.errors));

		// The module that does declare the platform is built for it
		assert.ok(report.artifacts.some(one => one.specifier === '@suite/shared/message'));
		return 'app: CONDITIONAL_NOT_FOUND for web; shared: web artifact produced';
	});
}
