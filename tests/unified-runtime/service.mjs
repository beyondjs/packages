/**
 * End to end: a source edit reaches a consumer that is already running, with nobody naming the update.
 *
 * The development service of Packages watches the workspace, rebuilds and announces `build.ended` on its
 * event stream. The unified runtime, registered in the consumer, receives the announcement, asks the service
 * for the update of each loaded module whose artifact changed and applies it. This driver only edits files
 * and asks the consumer what it observes. It validates Node consumers: see the README for the browser.
 */
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { Consumer, Fixture, Fork, Host, Runtime, results, step } from './harness.mjs';

const { BEE_URL, WATCHERS_URL } = process.env;
if (!BEE_URL || !WATCHERS_URL) throw new Error('Set BEE_URL and WATCHERS_URL to the Engine servers of Packages and of the watchers utility.');

const fork = new Fork();
const cleanup = [];
const fixture = await new Fixture().create(new Runtime());
cleanup.push(() => fixture.destroy());

const SHARED = '@fixture/shared@0.1.0/text';
let host;
let consumer;
let seen = 0;

// A port that is free now, so the service can be started again at the same origin
const port = await new Promise(resolve => {
	const probe = createServer().listen(0, '127.0.0.1', () => {
		const { port } = probe.address();
		probe.close(() => resolve(port));
	});
});
const launch = { implementation: BEE_URL, watchers: WATCHERS_URL, port, BEYOND_ESBUILD_COMPILER: fork.file };

const source = file => fixture.file('shared/text', file);
const rewrite = async (file, mutate) => writeFile(source(file), mutate(await readFile(source(file), 'utf8')));
const call = (handle, name, ...args) => consumer.call('call', { handle, name, args });

try {
	await step('service: the development service of Packages serves the workspace, the runtime included', async () => {
		host = await new Host().start(fixture.root, launch);
		cleanup.push(() => host.stop());

		const session = await (await fetch(`${host.origin}/session`)).json();
		assert.deepEqual(Object.keys(session.modules).sort(),
			['@beyond-js/local-2026/bundle', '@beyond-js/local-2026/core', '@beyond-js/local-2026/main', '@beyond-js/local-2026/routing', '@beyond-js/local-2026/styles', '@fixture/app/main', '@fixture/shared/text']);
		const state = await (await fetch(`${host.origin}/state`)).json();
		assert.deepEqual(state.modules.filter(module => module.status !== 'valid'), [], JSON.stringify(state.modules));
		return `${host.origin}, ${state.modules.length} modules valid`;
	});

	await step('consumer: it loads everything from the service and registers it in the runtime', async () => {
		consumer = await new Consumer('service-consumer.mjs').start(
			{ BEE_URL: host.origin, BEE_ADAPTER: 'packages', SERVICE_ORIGIN: host.origin }, fixture.file('.consumer'));
		cleanup.push(() => consumer.stop());

		const started = await consumer.call('start', { specifiers: { app: '@fixture/app/main', shared: '@fixture/shared/text' } });
		assert.equal(started.state, 'ready');
		assert.deepEqual(await consumer.call('registry'), ['@fixture/app@0.1.0/main', SHARED]);
		assert.equal(await call('app', 'main'), '[app] Hello World!');
		assert.deepEqual([await call('app', 'add'), await call('app', 'add')], [1, 2]);
		return 'connection ready; store counted to 2';
	});

	await step('update: a saved source reaches the running consumer through the announcement of the service', async () => {
		await rewrite('format.ts', text => text.replace('${subject}!`', '${subject}!!`'));
		seen = await consumer.call('until', { type: 'applied', from: seen });

		assert.equal(await call('app', 'main'), '[app] Hello World!!');
		assert.equal(await call('app', 'direct'), '[app] Hi there!!', 'The public re-export is current in the same update');
		assert.equal(await call('app', 'add'), 3, 'The store kept its state');
		assert.deepEqual(await consumer.call('evaluations'), { 'shared/index': 1, 'shared/format': 2, 'shared/store': 1 });
		assert.equal(await consumer.call('read', { handle: 'shared', name: 'captured' }), 'Hello once!', 'Boundary: captured at evaluation');

		const events = await consumer.call('events', {});
		assert.ok(events.some(([type, name]) => type === 'applied' && name === SHARED));
		assert.deepEqual(events.filter(([type]) => type === 'change'), [['change', 'shared']],
			'Only the module that changed announced it: the build also listed the application, whose update changed nothing');
		assert.deepEqual(events.filter(([type]) => type === 'error'), []);
		return `events: ${events.map(([type]) => type).join(', ')}`;
	});

	await step('failure and recovery: an invalid source is reported and changes nothing; its correction is applied', async () => {
		const valid = await readFile(source('format.ts'), 'utf8');
		await writeFile(source('format.ts'), 'export const format = ;\n');
		const after = await consumer.call('until', { type: 'invalid', from: seen });
		const reported = (await consumer.call('events', { from: seen })).find(([type]) => type === 'invalid');
		assert.equal(reported[1], SHARED);
		assert.equal(await call('app', 'main'), '[app] Hello World!!', 'The consumer keeps its last state');

		await writeFile(source('format.ts'), valid.replace('${subject}!!`', '${subject}?`'));
		seen = await consumer.call('until', { type: 'applied', from: after });
		assert.equal(await call('app', 'main'), '[app] Hello World?');
		assert.equal(await call('app', 'add'), 4, 'The store kept its state');
		return `invalid reported with ${reported[2].length} diagnostic(s); correction applied`;
	});

	await step('order: two edits saved in quick succession end in the last one, without errors', async () => {
		await rewrite('format.ts', text => text.replace('${subject}?`', '${subject} (1)`'));
		await new Promise(resolve => setTimeout(resolve, 60));
		await rewrite('format.ts', text => text.replace('${subject} (1)`', '${subject} (2)`'));

		seen = await consumer.call('until', { type: 'applied', from: seen });
		// A first build may have been applied before the second one was announced
		if ((await call('app', 'main')) !== '[app] Hello World (2)') seen = await consumer.call('until', { type: 'applied', from: seen });
		assert.equal(await call('app', 'main'), '[app] Hello World (2)');
		assert.deepEqual((await consumer.call('events', {})).filter(([type]) => type === 'error'), []);
		assert.equal(await call('app', 'add'), 5, 'The store kept its state');
		return 'last edit current';
	});

	await step('restart boundary: after the service restarts, the consumer is told it is stale and applies nothing more', async () => {
		await host.stop();
		host = await new Host().start(fixture.root, launch);
		cleanup.push(() => host.stop());

		// The runtime connects again with the cursor of the service that ended, which the new one cannot replay
		seen = await consumer.call('until', { type: 'stale', from: seen, ms: 60000 });
		const events = await consumer.call('events', {});
		assert.ok(events.some(([type, state]) => type === 'connection' && state === 'waiting'), 'It waited and connected again');
		assert.deepEqual(events.filter(([type]) => type === 'stale').map(([, reason]) => reason), ['EPOCH']);

		await rewrite('format.ts', text => text.replace('${subject} (2)`', '${subject} (after restart)`'));
		await new Promise(resolve => setTimeout(resolve, 3000));
		assert.equal(await call('app', 'main'), '[app] Hello World (2)', 'It is not declared current and nothing is applied: a restart is required');
		assert.equal(await call('app', 'add'), 6, 'The running consumer itself is intact');
		return 'reconnected, resync EPOCH reported as stale, later build not applied';
	});

	await step('lifecycle: closing releases the connection, and later edits are no longer applied', async () => {
		assert.deepEqual(await consumer.call('close'), { registered: false });
		await rewrite('format.ts', text => text.replace('${subject} (after restart)`', '${subject} (3)`'));
		await new Promise(resolve => setTimeout(resolve, 2500));
		assert.equal(await call('app', 'main'), '[app] Hello World (2)', 'Nothing is applied after close');
		return 'closed';
	});
} finally {
	const failed = results.some(result => !result.ok);
	failed && host && console.log(`--- service log ---\n${host.log.slice(-3000)}`);
	for (const release of cleanup.reverse()) await Promise.resolve(release()).catch(() => undefined);
}

const failed = results.filter(result => !result.ok);
console.log(`\n${results.length - failed.length}/${results.length} steps passed`);
process.exit(failed.length ? 1 : 0);
