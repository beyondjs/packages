/**
 * Bounded trial: the esbuild packaging mode compiled by Packages with the Beyond ESBuild fork.
 *
 * It checks what the mode has to establish before anything is adopted: which compiler actually built an
 * artifact, that a module selects its mode without changing its public identity, that packaged and composed
 * modules consume each other, that a packaged workspace is a production distribution with no Beyond
 * runtime, and what a development rebuild does and does not do to a consumer that is already running.
 * Read the local README for the processes involved and what this trial does not cover.
 */
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { Workspace } from '@beyond-js/packages/workspace';
import { Artifacts } from '@beyond-js/packages/artifacts';
import { WatchersService } from '@beyond-js/packages/watchers';
import { Consumer, Fixture, Fork, once, results, step, timeout } from './harness.mjs';

const { WATCHERS_URL } = process.env;
if (!WATCHERS_URL) throw new Error('Set WATCHERS_URL to the Engine server that serves the watchers utility.');

const fork = new Fork();
const installed = createRequire(join(process.cwd(), 'package.json'))('esbuild/package.json').version;
const cleanup = [];

/**
 * Builds a fixture for the given conditions and returns its report with an accessor by specifier
 */
const build = async (fixture, conditions, options) => {
	const workspace = new Workspace(fixture.root, options);
	cleanup.push(() => workspace.destroy());
	const artifacts = new Artifacts(workspace, { path: fixture.file('.artifacts'), conditions });
	const report = await artifacts.build();
	const artifact = specifier => report.artifacts.find(one => one.specifier === specifier);
	return { workspace, artifacts, report, artifact };
};

const fixture = async (modes, compiler = fork.specifier) => {
	const created = await new Fixture().create(modes, compiler);
	cleanup.push(() => created.destroy());
	return created;
};

const consume = async (importmap, cwd = process.cwd()) => {
	const consumer = await new Consumer().start(importmap, cwd);
	cleanup.push(() => consumer.stop());
	return consumer;
};

try {
	await step('compiler: the artifact names the fork that built it, not the esbuild Packages depends on', async () => {
		const { report, artifact } = await build(await fixture({ shared: 'esbuild', app: 'ts' }), { platform: 'node' });
		assert.deepEqual(report.errors, []);

		const { compiler, composition } = artifact('@suite/shared/message');
		assert.equal(composition, 'packaged');
		assert.equal(compiler.version, await fork.version());
		assert.notEqual(compiler.version, installed, 'It is not the version installed for the exports bundler');
		assert.equal(compiler.assigned, true, 'Only the fork accepts the assigned-exports option');
		assert.equal(compiler.location, fork.file);
		assert.match(compiler.provenance.revision, /^[0-9a-f]{40}$/);
		return `esbuild ${compiler.version} (fork, revision ${compiler.provenance.revision.slice(0, 8)}); installed dependency is ${installed}`;
	});

	await step('compiler (negative): no selection and an unimportable selection are diagnostics, never a fallback', async () => {
		const unselected = await build(await fixture({ shared: 'esbuild', app: 'ts' }, null), { platform: 'node' });
		assert.ok(unselected.report.errors.some(({ code }) => code === 'COMPILER_NOT_SELECTED'));
		assert.equal(unselected.artifact('@suite/shared/message'), undefined);

		const missing = await build(await fixture({ shared: 'esbuild', app: 'ts' }, 'esbuild-that-is-not-installed'), { platform: 'node' });
		assert.ok(missing.report.errors.some(({ code }) => code === 'COMPILER_IMPORT_ERROR'));
		assert.equal(missing.artifact('@suite/shared/message'), undefined);
		return 'COMPILER_NOT_SELECTED, COMPILER_IMPORT_ERROR';
	});

	await step('compiler: selecting the upstream dependency is reported as upstream, and packages the module too', async () => {
		const { report, artifact } = await build(await fixture({ shared: 'esbuild', app: 'ts' }, 'esbuild'), { platform: 'node' });
		assert.deepEqual(report.errors, []);
		const { compiler } = artifact('@suite/shared/message');
		assert.equal(compiler.version, installed);
		assert.equal(compiler.assigned, false);
		assert.equal(compiler.provenance, undefined);
		return `esbuild ${compiler.version}, upstream: the packaged ESM path uses no fork-specific option`;
	});

	for (const modes of [{ shared: 'esbuild', app: 'ts' }, { shared: 'ts', app: 'esbuild' }]) {
		await step(`selection: shared=${modes.shared}, app=${modes.app} keep their identities and consume each other`, async () => {
			const { report, artifact } = await build(await fixture(modes), { platform: 'node' });
			assert.deepEqual(report.errors, []);

			const packaged = artifact(modes.shared === 'esbuild' ? '@suite/shared/message' : '@suite/app/main');
			const composed = artifact(modes.shared === 'esbuild' ? '@suite/app/main' : '@suite/shared/message');
			assert.deepEqual([packaged.composition, packaged.ims, packaged.patch], ['packaged', [], undefined]);
			assert.equal(composed.composition, 'creators');
			assert.ok(composed.ims.length && composed.patch);
			assert.equal(artifact('@suite/shared/message').file, '@suite/shared@0.1.0/message.node.mjs', 'The mode is not part of the public address');

			const app = artifact('@suite/app/main');
			assert.deepEqual(app.dependencies.filter(({ source }) => source === 'workspace').map(({ specifier }) => specifier), ['@suite/shared/message']);
			assert.deepEqual(app.exports, ['custom', 'main']);

			const consumer = await consume(join(report.path, report.importmap));
			await consumer.call('load', { handle: 'app', specifier: '@suite/app/main' });
			assert.equal(await consumer.call('call', { handle: 'app', name: 'main' }), '[app] Hello Beyond!');
			assert.equal(await consumer.call('call', { handle: 'app', name: 'custom', args: ['World'] }), '[app] Hello World!');
			assert.deepEqual(await consumer.call('runtime'), [composed.vspecifier], 'Only the composed module registers in the runtime');
			return `${packaged.specifier} packaged (${packaged.inputs.length} inputs), ${composed.specifier} composed (${composed.ims.length} creators)`;
		});
	}

	await step('production: a packaged workspace is a minified distribution that references and registers no Beyond runtime', async () => {
		const both = await fixture({ shared: 'esbuild', app: 'esbuild' });
		const development = await build(both, { platform: 'node' });
		const production = await build(both, { platform: 'node', environment: 'production' });
		assert.deepEqual(production.report.errors, []);

		const app = production.artifact('@suite/app/main');
		assert.equal(app.file, '@suite/app@0.1.0/main.node.production.mjs');
		const size = async ({ report, artifact }) => (await readFile(join(report.path, artifact('@suite/shared/message').file), 'utf8')).length;
		assert.ok((await size(production)) < (await size(development)), 'The production conditional is minified');

		const consumer = await consume(join(production.report.path, production.report.importmap));
		assert.deepEqual(await consumer.call('load', { handle: 'app', specifier: '@suite/app/main' }), ['custom', 'main']);
		assert.equal(await consumer.call('call', { handle: 'app', name: 'main' }), '[app] Hello Beyond!');
		for (const specifier of ['@suite/app/main', '@suite/shared/message']) {
			const sources = production.artifact(specifier).dependencies.map(({ source }) => source);
			assert.ok(!sources.includes('runtime'), `${specifier} does not reference the Beyond runtime`);
		}
		assert.deepEqual(await consumer.call('runtime'), [], 'Nothing registered in a runtime, even where one can be resolved');

		const map = JSON.parse(await readFile(join(production.report.path, `${app.file}.map`), 'utf8'));
		assert.deepEqual(map.sources.sort(), ['decorate.ts', 'index.ts']);
		assert.ok(map.sourcesContent.every(content => typeof content === 'string' && content.length));
		return `exports ${app.exports.join(', ')}; sources ${map.sources.join(', ')} with content`;
	});

	await step('development: a watched edit rebuilds the packaged module only; a loaded consumer is a reload boundary', async () => {
		const service = new WatchersService('watchers', { env: { BEE_URL: WATCHERS_URL } });
		await service.start();
		cleanup.push(() => service.stop());

		const edited = await fixture({ shared: 'esbuild', app: 'esbuild' });
		const { workspace, artifacts, report, artifact } = await build(edited, { platform: 'node' }, { watcher: true });
		assert.deepEqual(report.errors, []);
		const before = { shared: artifact('@suite/shared/message').hash, app: artifact('@suite/app/main').hash };

		const running = await consume(join(report.path, report.importmap));
		await running.call('load', { handle: 'app', specifier: '@suite/app/main' });
		assert.equal(await running.call('call', { handle: 'app', name: 'custom', args: ['World'] }), '[app] Hello World!');

		const conditional = workspace.packages.get('shared').modules.get('./message').conditionals.get('node');
		const format = edited.file('shared/message/format.ts');
		const source = await readFile(format, 'utf8');
		const rebuild = async contents => {
			const changed = once(conditional, 'change');
			await writeFile(format, contents);
			await Promise.race([changed, timeout(10000, 'change event')]);
			return artifacts.build();
		};

		const rebuilt = await rebuild(source.replace('${subject}!`', '${subject}!!`'));
		const after = specifier => rebuilt.artifacts.find(one => one.specifier === specifier);
		assert.deepEqual(rebuilt.errors, []);
		assert.notEqual(after('@suite/shared/message').hash, before.shared);
		assert.equal(after('@suite/app/main').hash, before.app, 'The dependent artifact is byte-identical');

		await running.call('load', { handle: 'again', specifier: '@suite/app/main' });
		assert.equal(await running.call('call', { handle: 'again', name: 'custom', args: ['World'] }), '[app] Hello World!',
			'No update reaches the running consumer: nothing delivers or applies one in this mode yet');
		const restarted = await consume(join(rebuilt.path, rebuilt.importmap));
		await restarted.call('load', { handle: 'app', specifier: '@suite/app/main' });
		assert.equal(await restarted.call('call', { handle: 'app', name: 'custom', args: ['World'] }), '[app] Hello World!!');

		const broken = await rebuild('export const format = ;\n');
		assert.ok(broken.errors.some(({ code, message }) => code === 'BUNDLE_ERROR' && /format\.ts \(1:\d+\)/.test(message)));
		assert.equal(broken.artifacts.find(one => one.specifier === '@suite/shared/message'), undefined, 'A module that does not build is not published');
		const recovered = await rebuild(source);
		assert.equal(recovered.artifacts.find(one => one.specifier === '@suite/shared/message').hash, before.shared);
		return 'rebuild observed through the real watcher; restart required to observe it; error and recovery reported';
	});
} finally {
	for (const release of cleanup.reverse()) await Promise.resolve(release()).catch(() => undefined);
}

const failed = results.filter(result => !result.ok);
console.log(`\n${results.length - failed.length}/${results.length} steps passed`);
process.exit(failed.length ? 1 : 0);
