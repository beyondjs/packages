/**
 * The deterministic checks of the utilities this implementation runs on: which copy of each one the process
 * actually loaded, and the three defects that made a watched file silently stop being followed.
 *
 * Every check exercises the module the process executes, never a source file, so a run reports the behaviour
 * of the utilities the configuration selected and not the one of a checkout that nothing loads.
 */
import assert from 'node:assert/strict';
import { mkdtemp, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DynamicProcessor } from '@beyond-js/dynamic-processor/main';
import { Finder } from '@beyond-js/finder/main';
import { WatcherClient } from '@beyond-js/watchers/client';

/**
 * Where each utility module came from, which is what tells a local selection from the installed copy
 */
export const identities = () =>
	Object.fromEntries(
		['@beyond-js/dynamic-processor/main', '@beyond-js/finder/main', '@beyond-js/finder/collection', '@beyond-js/watchers/client'].map(
			specifier => [specifier, import.meta.resolve(specifier)]
		)
	);

/**
 * A subclass that emits an event of its own, which is what the finder does.
 *
 * The mixin forwards the prototype members of the implementation, so an emitter held as an instance field
 * is not forwarded: the outer object reads `undefined` and every emit of the subclass throws, while its
 * subscribers are registered on the emitter of the implementation and never hear anything.
 */
export async function emitter() {
	class Subclass extends DynamicProcessor() {
		get dp() {
			return 'utilities.subclass';
		}
		announce(event, ...params) {
			return this._events.emit(event, ...params);
		}
	}

	const instance = new Subclass();
	assert.ok(instance._events, 'the emitter of the implementation is reachable from the outer object');

	const heard = [];
	instance.on('own', value => heard.push(value));
	assert.equal(instance.announce('own', 'delivered'), true, 'the emit reports a subscriber');
	assert.deepEqual(heard, ['delivered'], 'the subscriber of the outer object was notified');

	// The emitter is one object: subscribing and emitting must not reach two of them
	assert.equal(instance._events, instance._events);
	return 'a subclass emit reaches the subscribers of the outer object';
}

/**
 * The change announcement of a finder is deferred, so a finder destroyed inside that window must not emit:
 * an emit on a destroyed processor reaches collaborators that released it and takes the service down.
 */
export async function destroyed(watcher) {
	const root = await realpath(await mkdtemp(join(tmpdir(), 'beyond-utilities-finder-')));
	await writeFile(join(root, 'one.ts'), 'export const one = 1;\n');

	// A destroyed processor announces its destruction, so what a destruction alone announces is measured
	const count = async announce => {
		const heard = [];
		const finder = new Finder(root, { extname: '.ts' }, watcher);
		await finder.ready;
		finder.on('change', () => heard.push('change'));

		announce && finder.emit('change');
		finder.destroy();
		await new Promise(resolve => setTimeout(resolve, 200));
		return heard.length;
	};

	const control = await count(false);
	const pending = await count(true);

	assert.equal(pending, control, 'the announcement deferred before the destruction was not delivered after it');
	return `a destruction announces ${control}; a deferred announcement inside its window adds none`;
}

/**
 * `all` and the event itself are independent announcements of the watchers client: a subscriber of one that
 * throws must not keep the others from being notified, which is how a file silently stopped being watched.
 */
export async function isolation(watcher) {
	const root = await realpath(await mkdtemp(join(tmpdir(), 'beyond-utilities-listener-')));
	const file = join(root, 'watched.txt');
	await writeFile(file, 'one\n');

	const client = new WatcherClient('watchers', { is: 'test', path: root });
	await client.start();

	const listener = client.listeners.create(root, {});
	await listener.listen();

	const heard = [];
	listener.on('all', () => {
		throw new Error('a subscriber of "all" that throws');
	});
	listener.on('change', name => heard.push(name));

	// The client announces what the service reports; the write is what the service observes
	const deadline = Date.now() + 15000;
	await new Promise(resolve => setTimeout(resolve, 300));
	await writeFile(file, 'two\n');
	while (!heard.length && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 100));

	listener.destroy();
	client.destroy();

	assert.ok(heard.length, 'the specific event was announced although the subscriber of "all" threw');
	return `"change" delivered after "all" threw (${heard.length} announcement(s))`;
}
