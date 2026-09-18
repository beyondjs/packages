/**
 * What happens to a running consumer when the sources change: the artifacts execute on their own, editing a
 * source regenerates the right one through the watcher, and the resulting update applies to the module the
 * consumer already loaded, with the update semantics of the runtime made explicit.
 */
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { artifactsPath, once, step, timeout } from './harness.mjs';

/**
 * @param context The workspace, artifacts writer, consumer, fixture sources and report holder of the run
 */
export async function updates(context) {
	const { artifacts, consumer, sources } = context;

	/**
	 * Edits a source and waits for the compilation of the affected module to react, instead of assuming that
	 * a rebuild happened: what is being checked is that watching causes it
	 */
	const rebuild = async (dp, edit) => {
		const changed = once(dp, 'change');
		await edit();
		await Promise.race([changed, timeout(10000, 'change event')]);
		context.report = await artifacts.build();
		return context.report;
	};

	const shared = () => context.conditional('shared', './message');

	let observed;
	await step('consumer: a plain Node process executes the artifacts through the import map', async () => {
		await consumer.start(join(artifactsPath, context.report.importmap));
		observed = await consumer.call('load');

		assert.equal(observed.main, '[app] Hello Beyond!');
		assert.equal(observed.custom, '[app] Hello World!');
		assert.equal(observed.message, 'Hello Beyond!');

		// The namespace of a public module exposes its API and the runtime handles, not its internals
		assert.deepEqual(observed.sharedExports, ['__beyond_pkg', 'greet', 'hmr', 'message']);
		assert.deepEqual(observed.appExports, ['__beyond_pkg', 'custom', 'hmr', 'main']);

		// Both modules are separate artifacts registered in one runtime
		assert.deepEqual(observed.instances, ['@suite/app@0.1.0/main', '@suite/shared@0.1.0/message']);
		assert.deepEqual(observed.evaluations, { 'shared/format': 1, 'shared/index': 1 });
		return `main() = "${observed.main}", one runtime registry with both packages`;
	});

	const before = { shared: context.artifact('@suite/shared/message'), app: context.artifact('@suite/app/main') };

	await step('edit shared/format.ts: the watcher triggers regeneration of the right artifact only', async () => {
		const report = await rebuild(shared(), () =>
			writeFile(sources.formatFile, sources.format.replace('${subject}!`', '${subject}!!`'))
		);
		assert.deepEqual(report.errors, []);

		const message = context.artifact('@suite/shared/message');
		const app = context.artifact('@suite/app/main');
		assert.notEqual(message.hash, before.shared.hash, 'shared artifact changed');
		assert.equal(app.hash, before.app.hash, 'app artifact unchanged');

		// Inside the changed module, only the internal module of the edited file changed
		const hashes = ims => Object.fromEntries(ims.map(im => [im.id, im.hash]));
		const previous = hashes(before.shared.ims);
		const current = hashes(message.ims);
		assert.notEqual(current['./format'], previous['./format'], './format changed');
		assert.equal(current['./index'], previous['./index'], './index unchanged');
		assert.equal(current['./instrumentation'], previous['./instrumentation']);
		return `shared ${before.shared.hash.slice(0, 8)} → ${message.hash.slice(0, 8)}; app ${app.hash.slice(0, 8)} unchanged`;
	});

	await step('update: the consumer applies the shared update to the original runtime package', async () => {
		const message = context.artifact('@suite/shared/message');
		const patched = await consumer.call('patch', { file: join(artifactsPath, message.patch) });

		// The module keeps its identity: consumers hold the same package, not a second copy of it
		assert.deepEqual(patched.identity, { shared: true, app: true }, 'runtime package identities preserved');
		assert.deepEqual(patched.instances, observed.instances, 'no new registry entries');

		// Only the changed internal module is created again
		assert.deepEqual(patched.evaluations, { 'shared/format': 2, 'shared/index': 1 });

		// A value read when it is used observes the update through the original imports
		assert.equal(patched.custom, '[app] Hello World!!');
		assert.equal(patched.greet, 'Hello World!!');

		// A value computed when its own internal module was evaluated is not recomputed by this update
		assert.equal(patched.main, '[app] Hello Beyond!');
		assert.equal(patched.message, 'Hello Beyond!');
		return 'custom() updated through original import; captured message unchanged; ./index not re-executed';
	});

	await step('edit shared/index.ts: the entry update recomputes the captured value', async () => {
		const report = await rebuild(shared(), () =>
			writeFile(sources.indexFile, sources.index.replace("'Beyond'", "'Patched'"))
		);
		assert.deepEqual(report.errors, []);

		const message = context.artifact('@suite/shared/message');
		const patched = await consumer.call('patch', { file: join(artifactsPath, message.patch) });
		assert.deepEqual(patched.identity, { shared: true, app: true });
		assert.deepEqual(patched.evaluations, { 'shared/format': 2, 'shared/index': 2 });
		assert.equal(patched.message, 'Hello Patched!!');

		// The app was not rebuilt: it reads the live public binding of the module it imports
		assert.equal(patched.main, '[app] Hello Patched!!', 'app reads the live public binding of shared');
		return `main() = "${patched.main}" through the original app import`;
	});

	await step(
		'compilation error: reported as a diagnostic, stale output not presented, unrelated artifact stable',
		async () => {
			const report = await rebuild(shared(), () => writeFile(sources.formatFile, 'export const separator = ;\n'));

			const reported = report.errors.some(
				one => one.code === 'TRANSPILE_ERROR' && /format\.ts/.test(one.message)
			);
			assert.ok(reported, JSON.stringify(report.errors));

			// A module that does not compile publishes nothing, instead of keeping its previous output
			assert.equal(shared().valid, false);
			assert.equal(shared().output, undefined);
			assert.ok(!report.artifacts.some(one => one.specifier === '@suite/shared/message'));
			assert.equal(context.artifact('@suite/app/main').hash, before.app.hash);
			return 'TRANSPILE_ERROR on format.ts; app artifact unchanged';
		}
	);

	await step('recovery: restoring the sources regenerates the original artifacts', async () => {
		await rebuild(shared(), async () => {
			await writeFile(sources.formatFile, sources.format);
			await writeFile(sources.indexFile, sources.index);
		});

		// Two files are restored, and each one is an independent filesystem event
		for (let i = 0; i < 20 && context.artifact('@suite/shared/message')?.hash !== before.shared.hash; i++) {
			await new Promise(resolve => setTimeout(resolve, 100));
			context.report = await artifacts.build();
		}

		assert.deepEqual(context.report.errors, []);
		assert.equal(context.artifact('@suite/shared/message').hash, before.shared.hash);
		assert.equal(context.artifact('@suite/app/main').hash, before.app.hash);
		return 'hashes back to the initial build';
	});
}
