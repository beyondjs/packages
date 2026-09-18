/**
 * Stage-1 validation: two packages compiled by Packages into separate executable artifacts.
 *
 * It checks the chain a package developer depends on, from the declaration of a public module to the value
 * a consumer reads after editing a source: discovery of the packages and their modules, selection of the
 * bundler and the conditions, compilation into artifacts that keep their public references, resolution of
 * the dependencies between packages, regeneration of the right artifact when a source changes, and
 * application of the resulting update to a consumer that is still running. Every behavior is also checked
 * in the negative, which is what a package developer sees when something is wrong.
 *
 * The checks live in [build](build.mjs) and [updates](updates.mjs); this file owns the services they need
 * and the cleanup. The fixture is the suite testbed (`@suite/shared` and `@suite/app`): negative cases run
 * on temporary copies of it, so only the update checks edit it, and it is restored even when a step fails.
 * Read the local README for the processes involved and how to run this file.
 */
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Workspace } from '@beyond-js/packages/workspace';
import { Artifacts } from '@beyond-js/packages/artifacts';
import { WatchersService } from '@beyond-js/packages/watchers';
import { artifactsPath, conditions, Consumer, results, step, testbed } from './harness.mjs';
import { build } from './build.mjs';
import { updates } from './updates.mjs';

/**
 * The development server that serves the watchers service to the child process that watches the sources.
 * The Packages implementation itself is served to this process by the loader that started it.
 */
const { WATCHERS_URL } = process.env;
if (!WATCHERS_URL) throw new Error('Set WATCHERS_URL to the Engine server that serves the watchers utility.');

/**
 * The fixture sources the update checks edit, read before anything runs so they can be restored
 */
const formatFile = join(testbed, 'shared/message/format.ts');
const indexFile = join(testbed, 'shared/message/index.ts');
const sources = {
	formatFile,
	indexFile,
	format: await readFile(formatFile, 'utf8'),
	index: await readFile(indexFile, 'utf8')
};
if (!sources.format.includes('${subject}!`')) throw new Error('The shared fixture is not in its original state');

const service = new WatchersService('watchers', { env: { BEE_URL: WATCHERS_URL } });
const workspace = new Workspace(testbed, { watcher: true });
const consumer = new Consumer();

/**
 * What the checks share: the objects under test, the last build report and the accessors they read it with
 */
const context = {
	workspace,
	artifacts: new Artifacts(workspace, { path: artifactsPath, conditions }),
	consumer,
	sources,
	report: undefined,
	artifact: specifier => context.report.artifacts.find(one => one.specifier === specifier),
	conditional: (location, subpath) => workspace.packages.get(location).modules.get(subpath).conditionals.get('node')
};

try {
	await step('watchers service: a misconfigured service reports its startup failure', async () => {
		const broken = new WatchersService('broken', {
			env: { BEE_URL: WATCHERS_URL },
			specifier: '@beyond-js/watchers/service/does-not-exist',
			timeout: 10000
		});
		await assert.rejects(broken.start(), /failed to start/);
		assert.equal(broken.started, false);
		return 'start() rejected, nothing registered';
	});

	await step('watchers service: starts a child process under BEE Node', async () => {
		await service.start();
		assert.equal(service.started, true);
		assert.ok(service.pid > 0);
		return `pid ${service.pid}`;
	});

	await build(context);
	await updates(context);
} finally {
	await writeFile(formatFile, sources.format);
	await writeFile(indexFile, sources.index);

	await step('cleanup: consumer exits, watcher child stops, workspace destroyed', async () => {
		const code = await consumer.stop();
		assert.equal(code, 0);

		const pid = service.pid;
		await service.stop();
		assert.equal(service.started, false);
		assert.throws(() => process.kill(pid, 0), 'watcher child process terminated');

		workspace.destroy();
		return `consumer exit 0; watcher child ${pid} terminated`;
	});
}

const failed = results.filter(result => !result.ok);
console.log(`\n${results.length - failed.length}/${results.length} steps passed`);
process.exit(failed.length ? 1 : 0);
