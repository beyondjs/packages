import assert from 'node:assert/strict';
import { revision, step } from './harness.mjs';
import { serve, until } from './service.mjs';

/**
 * Stands for the events of the hosting service (`service/host/events.mjs`), which the extension follows: what a case
 * emits reaches the extension as the host's features announce it
 */
class Host {
	#listeners = new Set();

	subscribe(listener) {
		this.#listeners.add(listener);
		return () => this.#listeners.delete(listener);
	}

	emit(type, data) {
		this.#listeners.forEach(listener => listener(type, data));
	}
}

/**
 * The events of a hosting service on the event stream of the extension (`GET /events`): a stored one is appended to
 * the log and replayed after a cursor; a transient one (`launch.output`, `operation.progress`, `Development.TRANSIENT`)
 * reaches the open subscribers in order with the stored ones and is never kept, so a burst of them evicts no source
 * event from the replay and leaves the builds' view of what changed as it was.
 */
export async function events() {
	await step('host-events: launch.output and operation.progress reach an open stream in order, are never replayed and evict no source event', async () => {
		const host = new Host();
		const context = await serve({ 'a.ts': 'one' }, void 0, host);
		const { log } = context.development.files;
		const stream = await context.subscribe();
		await until(() => stream.messages.some(({ event }) => event === 'subscribed'), 'the subscription');

		const written = await context.call('PUT', '/files/content/a.ts', { body: 'two', headers: { 'if-match': `"${revision('one')}"` } });
		assert.equal(written.status, 200, JSON.stringify(written.body));
		const source = written.body.cursor;

		// More notifications than the log keeps events (2000): stored, they would push the source event out of it. The
		// output of a launch and the progress of an operation alternate, as a launch and an installation running at once
		const burst = 2500;
		for (let next = 1; next <= burst; next++) {
			next % 2
				? host.emit('launch.output', { launch: { id: 'lch_000000000000000000000001' }, next })
				: host.emit('operation.progress', { operation: { id: 'op_000000000000000000000001', state: 'running', steps: [{ id: 'fetch', counts: { done: next } }] } });
		}
		host.emit('settings.changed', { revision: 'sha256-after' });

		const transient = new Set(['launch.output', 'operation.progress']);
		const followed = new Set(['file.changed', 'settings.changed', ...transient]);
		const received = () => stream.messages.filter(({ event }) => followed.has(event));
		await until(() => received().some(({ event }) => event === 'settings.changed'), 'the stored event after the burst', 10000);
		const order = received().map(({ event, next, operation }) => (event === 'launch.output' ? next : event === 'operation.progress' ? operation.steps[0].counts.done : event));
		assert.deepEqual(order, ['file.changed', ...Array.from({ length: burst }, (value, index) => index + 1), 'settings.changed']);
		stream.close();

		const replay = log.since(source);
		assert.equal(replay.resync, void 0, 'the source event is still in the replay');
		assert.deepEqual(replay.events.filter(({ type }) => transient.has(type)), [], 'no notification is replayed');
		assert.ok(replay.events.some(({ type, revision: value }) => type === 'settings.changed' && value === 'sha256-after'));

		// A subscriber that returns with the cursor of the source event receives the stored events after it, and no output
		const returning = await context.subscribe({ cursor: source });
		await until(() => returning.messages.some(({ event }) => event === 'subscribed'), 'the replay');
		const replayed = returning.messages.map(({ event }) => event);
		assert.ok(replayed.includes('settings.changed') && !replayed.some(event => transient.has(event)) && !replayed.includes('resync'), replayed.join(', '));
		returning.close();
		context.stop();
		return `${burst} notifications delivered in order; the replay after the write holds ${replay.events.length} stored events`;
	});
}
