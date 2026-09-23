/**
 * One development runtime, several environments and emitters: the same updates reach consumers that run
 * in Node.js (through BEE Node) and in Deno, and that receive their notifications from the event stream of
 * the development service, from an external emitter over an event stream of its own, from an object source
 * and through `local.hmr.notify()`.
 *
 * Every consumer runs `environment-consumer.mjs` against one development service. The driver edits files
 * and asks each consumer what its runtime applied; the relay (`relay.mjs`) stands for the external emitter.
 */
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { Fixture, Fork, Host, Runtime, results, step } from './harness.mjs';
import { Channel, Deno } from './channel.mjs';
import { Relay } from './relay.mjs';

const { BEE_URL, WATCHERS_URL } = process.env;
if (!BEE_URL || !WATCHERS_URL) throw new Error('Set BEE_URL and WATCHERS_URL to the Engine servers of Packages and of the watchers utility.');
const deno = new Deno();
if (!deno.available) throw new Error('Set BEYOND_DENO to a Deno 2 executable.');

const SHARED = '@fixture/shared@0.1.0/text';
const fork = new Fork();
const cleanup = [];
const fixture = await new Fixture().create(new Runtime());
cleanup.push(() => fixture.destroy(), () => deno.destroy());

// A port that is free now, so the service can be started again at the same origin
const port = await new Promise(resolve => {
	const probe = createServer().listen(0, '127.0.0.1', () => {
		const { port } = probe.address();
		probe.close(() => resolve(port));
	});
});
const launch = { implementation: BEE_URL, watchers: WATCHERS_URL, port, BEYOND_ESBUILD_COMPILER: fork.file };

/**
 * The consumers: the environment each runs in, and where its notifications come from
 */
const consumers = [
	{ name: 'node/stream', runtime: 'node', events: 'stream' },
	{ name: 'node/object', runtime: 'node', events: 'object' },
	{ name: 'node/notify', runtime: 'node', events: 'notify' },
	{ name: 'deno/stream', runtime: 'deno', events: 'stream' },
	{ name: 'deno/relay', runtime: 'deno', events: 'relay' }
];
const channels = [];
const seen = new Map();
const relayed = [];

let host, relay;

const source = (...parts) => fixture.file('shared/text', ...parts);
const rewrite = async (file, mutate) => writeFile(source(file), mutate(await readFile(source(file), 'utf8')));
const every = (action, params) => Promise.all(channels.map(channel => channel.call(action, params)));
const same = (values, expected, message) => assert.deepEqual(values, channels.map(() => expected), message);
const main = () => every('call', { handle: 'app', name: 'main' });
const add = () => every('call', { handle: 'app', name: 'add' });

/**
 * Waits until every consumer recorded an event of the type after the events it already reported
 */
const until = type => Promise.all(channels.map(async channel => seen.set(channel, await channel.call('until', { type, from: seen.get(channel) ?? 0 }))));
const recorded = (type, from) => Promise.all(channels.map(async channel => (await channel.call('events', { from: from.get(channel) ?? 0 })).filter(([name]) => name === type)));

/**
 * The import map a Deno consumer resolves through: the one the service publishes, or else one written from
 * its session, which names every module the service serves
 */
const importmap = async () => {
	const published = await fetch(`${host.origin}/importmap.json?target=node&format=esm`).catch(() => void 0);
	if (published?.ok && (await published.clone().json().catch(() => ({}))).imports) return { map: published.url, from: 'the service' };

	const { options, modules } = await (await fetch(`${host.origin}/session`)).json();
	const imports = Object.fromEntries(Object.entries(modules).map(([specifier, { path }]) => [specifier, `${host.origin}${path}?${options}`]));
	return { map: { imports }, from: 'the session' };
};

try {
	await step('service: the development service serves the workspace, the runtime included', async () => {
		host = await new Host().start(fixture.root, launch);
		cleanup.push(() => host.stop());

		const state = await (await fetch(`${host.origin}/state`)).json();
		assert.deepEqual(state.modules.filter(module => module.status !== 'valid'), [], JSON.stringify(state.modules));
		return `${host.origin}, ${state.modules.length} modules valid`;
	});

	await step('relay: an external emitter reads the events of the service and publishes them at another origin', async () => {
		relay = await new Relay().start(`${host.origin}/events`);
		cleanup.push(() => relay.stop());
		return relay.url;
	});

	await step('consumers: Node.js and Deno load everything from the service and register it with their source of notifications', async () => {
		const { map, from } = await importmap();
		const execArgv = process.execArgv.filter(arg => !arg.startsWith('--inspect'));

		for (const consumer of consumers) {
			const events = consumer.events === 'relay' ? relay.url : consumer.events;
			const env = { SERVICE_ORIGIN: host.origin, CONSUMER_EVENTS: events };
			const channel = new Channel(consumer.name);
			const command = consumer.runtime === 'node' ? [process.execPath, ...execArgv] : await deno.command(map);
			const environment = consumer.runtime === 'node'
				? { ...process.env, BEE_URL: host.origin, BEE_ADAPTER: 'packages', BEE_IMPORT_MAP: '', ...env }
				: { PATH: process.env.PATH, HOME: process.env.HOME, ...deno.env, ...env };
			await channel.start(command, environment, fixture.file('.consumer'));
			channels.push(channel);
			cleanup.push(() => channel.stop());

			const started = await channel.call('start', { specifiers: { app: '@fixture/app/main', shared: '@fixture/shared/text' } });
			const expected = { stream: 'stream', relay: 'stream', object: 'object', notify: 'none' }[consumer.events];
			assert.deepEqual(started, { state: 'ready', source: expected, platform: 'node', environment: consumer.runtime, loader: 'module' }, consumer.name);

			// The object source and notify() receive what the relay holds, as a Workspace administration would deliver it
			if (['object', 'notify'].includes(consumer.events)) {
				const release = relay.on(event => channel.call('deliver', { event }).catch(error => relayed.push(`${consumer.name}: ${error.message}`)));
				cleanup.push(release);
			}
		}

		same(await every('registry'), ['@fixture/app@0.1.0/main', SHARED]);
		same(await main(), '[app] Hello World!');
		same(await add(), 1);
		const sheets = await every('stylesheet', { vspecifier: SHARED });
		assert.ok(sheets.every(sheet => sheet?.version === 0 && sheet.href.includes('/styles/text?')), JSON.stringify(sheets));

		const notify = channels.find(channel => channel.name === 'node/notify');
		assert.equal(await notify.call('refusal', { event: { build: {} } }), 'TypeError: A notification is an event document with a "type"');
		return `${channels.length} consumers; the Deno import map from ${from}`;
	});

	await step('update: a saved source is applied in every environment, whoever emitted the notification', async () => {
		await rewrite('format.ts', text => text.replace('${subject}!`', '${subject}!!`'));
		await until('applied');

		same(await main(), '[app] Hello World!!');
		same(await every('call', { handle: 'app', name: 'direct' }), '[app] Hi there!!');
		same(await add(), 2, 'The store kept its state');
		same(await every('evaluations'), { 'shared/index': 1, 'shared/format': 2, 'shared/store': 1 });
		same((await recorded('error', new Map())).map(errors => errors.length), 0);

		// The build that carried the update built the runtime's coordinator for both platforms, without diagnostics
		const { build } = await relay.until(({ type, build }) => type === 'build.ended' && build.state === 'completed');
		const coordinator = build.modules.filter(({ vspecifier }) => vspecifier === '@beyond-js/local-2026@0.1.0/main');
		assert.deepEqual(coordinator.map(({ platform, status }) => [platform, status]), [['node', 'valid'], ['web', 'valid']]);
		assert.deepEqual((build.diagnostics ?? []).filter(({ message }) => message.includes('local-2026')), []);
	});

	await step('invalid build: a source that does not compile changes nothing, and its correction is applied', async () => {
		const valid = await readFile(source('format.ts'), 'utf8');
		const before = new Map(seen);
		await writeFile(source('format.ts'), 'export const format = ;\n');
		await until('invalid');
		assert.ok((await recorded('invalid', before)).every(events => events.some(([, name]) => name === SHARED)));
		same(await main(), '[app] Hello World!!', 'Every consumer keeps its last state');

		await writeFile(source('format.ts'), valid.replace('${subject}!!`', '${subject}?`'));
		await until('applied');
		same(await main(), '[app] Hello World?');
		same(await add(), 3, 'The store kept its state');
	});

	await step('evaluation failure: a source that throws when evaluated fails its update, and its correction is applied', async () => {
		const valid = await readFile(source('format.ts'), 'utf8');
		const before = new Map(seen);
		await writeFile(source('format.ts'), `throw new Error('evaluation failed');\n${valid}`);
		await until('error');
		const errors = await recorded('error', before);
		assert.ok(errors.every(events => events.some(([, name, message]) => name === SHARED && /evaluation failed/.test(message))), JSON.stringify(errors));

		await writeFile(source('format.ts'), valid.replace('${subject}?`', '${subject}.`'));
		await until('applied');
		same(await main(), '[app] Hello World.');
		same(await add(), 4, 'The store kept its state');
	});

	await step('stylesheet: a new sheet replaces the registered one; an invalid one keeps the last valid sheet until its correction', async () => {
		// The first build a consumer receives lists the sheet it loaded, which is replaced once by the same content
		const valid = await readFile(source('text.scss'), 'utf8');
		const initial = await every('stylesheet', { vspecifier: SHARED });
		await writeFile(source('text.scss'), valid.replace('rgb(10, 20, 30)', 'rgb(40, 50, 60)'));
		await until('styles');
		const first = await every('stylesheet', { vspecifier: SHARED });
		assert.ok(first.every((sheet, index) => sheet.version > initial[index].version && /\/u\/[0-9a-f]{32}\/@fixture\/shared@0\.1\.0\/styles\/text\?/.test(sheet.href)), JSON.stringify(first));
		const css = await (await fetch(new URL(first[0].href, host.origin))).text();
		assert.match(css, /rgb\(40, 50, 60\)/);

		const before = new Map(seen);
		await writeFile(source('text.scss'), valid.replace('$ink;', '$missing;'));
		await until('invalid');
		assert.ok((await recorded('invalid', before)).every(events => events.some(([, name]) => name === SHARED)));
		assert.deepEqual(await every('stylesheet', { vspecifier: SHARED }), first, 'The last valid stylesheet is kept');

		await writeFile(source('text.scss'), valid.replace('rgb(10, 20, 30)', 'rgb(70, 80, 90)'));
		await until('styles');
		const corrected = await every('stylesheet', { vspecifier: SHARED });
		assert.ok(corrected.every((sheet, index) => sheet.version === first[index].version + 1 && sheet.href !== first[index].href), JSON.stringify(corrected));
		assert.match(await (await fetch(new URL(corrected[0].href, host.origin))).text(), /rgb\(70, 80, 90\)/);
		same(await add(), 5, 'The code kept its state');
	});

	await step('order: two edits saved in quick succession end in the last one everywhere, without errors', async () => {
		const before = new Map(seen);
		await rewrite('format.ts', text => text.replace('${subject}.`', '${subject} (1)`'));
		await new Promise(resolve => setTimeout(resolve, 60));
		await rewrite('format.ts', text => text.replace('${subject} (1)`', '${subject} (2)`'));

		// A first build may be applied before the second one is announced: each consumer waits for the last
		for (const channel of channels) {
			for (const deadline = Date.now() + 60000; ; ) {
				seen.set(channel, await channel.call('until', { type: 'applied', from: seen.get(channel) }));
				if ((await channel.call('call', { handle: 'app', name: 'main' })) === '[app] Hello World (2)') break;
				if (Date.now() > deadline) throw new Error(`${channel.name} did not apply the last edit`);
			}
		}
		same(await main(), '[app] Hello World (2)');
		same((await recorded('error', before)).map(errors => errors.length), 0);
		same(await add(), 6, 'The store kept its state');
	});

	await step('restart boundary: after the service restarts, every consumer is told it is stale and applies nothing more', async () => {
		await host.stop();
		host = await new Host().start(fixture.root, launch);
		cleanup.push(() => host.stop());

		// The streams connect again with the cursor of the service that ended, which the new one cannot replay;
		// the relay does the same and relays the resync it receives
		const before = new Map(seen);
		await until('stale');
		same((await recorded('stale', before)).map(events => events.map(([, reason]) => reason)), ['EPOCH']);

		// The next build reaches every consumer, which applies nothing of it
		const applied = new Map(seen);
		const from = relay.events.length;
		await rewrite('format.ts', text => text.replace('${subject} (2)`', '${subject} (after restart)`'));
		const { build } = await relay.until(({ type, build }) => type === 'build.ended' && build.state === 'completed' && build.modules.some(({ vspecifier }) => vspecifier === SHARED), from);
		await Promise.all(channels.map(channel => channel.call('until', { type: 'notified', value: build.id, from: applied.get(channel) })));
		same(await main(), '[app] Hello World (2)', 'Nothing is applied: a restart is required');
		same((await recorded('applied', applied)).map(events => events.length), 0);
		same(await add(), 7, 'The running consumers themselves are intact');
		assert.deepEqual(relayed, [], 'Every relayed notification was delivered');
	});

	await step('lifecycle: closing releases the connection and the source in every consumer', async () => {
		same(await every('close'), { registered: false });
	});
} finally {
	const failed = results.some(result => !result.ok);
	failed && host && console.log(`--- service log ---\n${host.log.slice(-3000)}`);
	failed && channels.forEach(channel => console.log(`--- ${channel.name} ---\n${channel.log.slice(-2000)}`));
	for (const release of cleanup.reverse()) await Promise.resolve().then(release).catch(() => undefined);
}

const failed = results.filter(result => !result.ok);
console.log(`\n${results.length - failed.length}/${results.length} steps passed`);
process.exit(failed.length ? 1 : 0);
