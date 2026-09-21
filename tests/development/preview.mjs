/**
 * The development selection and the preview entry, over the stand-in delivery of the service group: what is
 * checked here is the contract of the two documents, their access and their persistence. The real delivery,
 * a real browser and the application of updates are validated by `tests/preview`.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { step, revision } from './harness.mjs';
import { Signer, serve, until, vectors } from './service.mjs';

const { Access } = await import('@beyond-js/packages/development');
const kernel = JSON.parse(readFileSync(new URL('../../node_modules/@beyond-js/kernel/package.json', import.meta.url), 'utf8')).version;
const seed = { 'app/main/index.ts': 'export const v = 1;' };

export async function preview() {
	await step('files-never-select, selection-is-not-a-source-file and unknown-selection-is-refused', async () => {
		const context = await serve(seed);
		const events = [];
		context.development.files.log.subscribe(event => events.push(event));
		const selection = async () => (await context.call('GET', '/development/selection')).body;

		assert.deepEqual(await selection(), { explicit: false, packages: ['@case/app'], modules: [], unknown: [] });
		const path = '/files/content/app/main/index.ts';
		await context.call('GET', path);
		await context.call('PUT', path, { body: 'export const v = 2;', headers: { 'if-match': `"${revision(seed['app/main/index.ts'])}"` } });
		await context.call('PUT', '/files/content/app/other.ts', { body: 'export {};', headers: { 'if-none-match': '*' } });
		await until(() => events.some(({ type }) => type === 'build.ended'), 'the build of the edit');
		assert.deepEqual(await selection(), { explicit: false, packages: ['@case/app'], modules: [], unknown: [] });

		const refused = await context.call('PUT', '/development/selection', { body: JSON.stringify({ packages: ['@case/missing'] }) });
		assert.deepEqual([refused.status, refused.body.error.code, refused.body.error.unknown], [400, 'SELECTION_INVALID', ['@case/missing']]);
		assert.equal((await selection()).explicit, false);

		const replaced = await context.call('PUT', '/development/selection', { body: JSON.stringify({ modules: ['@case/app/main'] }) });
		assert.deepEqual(replaced.body, { explicit: true, packages: [], modules: ['@case/app/main'], unknown: [] });
		assert.deepEqual(events.filter(({ type }) => type === 'selection.changed').map(({ selection: announced }) => announced), [replaced.body]);

		assert.ok(existsSync(context.project.file('.beyond/development/selection.json')));
		assert.equal(readFileSync(context.project.file('.beyond/.gitignore'), 'utf8'), '*\n');
		const tree = (await context.call('GET', '/files/tree?scan=true')).body;
		assert.deepEqual(tree.entries.filter(({ kind }) => kind === 'file').map(({ path: name }) => name), ['app/main/index.ts', 'app/other.ts']);
		assert.deepEqual(events.filter(({ path: name }) => name?.startsWith('.beyond')), [], 'The state directory is not announced');
		const written = await context.call('PUT', '/files/content/.beyond/development/selection.json', { body: '{}', headers: { 'if-none-match': '*' } });
		assert.deepEqual([written.status, written.body.error.code], [403, 'PATH_FORBIDDEN']);

		assert.equal((await context.call('DELETE', '/development/selection')).body.explicit, false);
		context.stop();
		return 'read, write, create and build left the selection as it was';
	});

	await step('the selection is persisted with the working copy: a new service over the same root reads it', async () => {
		const first = await serve(seed);
		await first.call('PUT', '/development/selection', { body: JSON.stringify({ packages: ['@case/app'] }) });
		const stored = readFileSync(first.project.file('.beyond/development/selection.json'), 'utf8');
		first.development.stop();

		const { Development } = await import('@beyond-js/packages/development');
		const { Delivery } = await import('./service.mjs');
		const again = new Development({ delivery: new Delivery(first.project), settings: { root: first.project.path } });
		assert.deepEqual(await again.selection.read(), { explicit: true, packages: ['@case/app'], modules: [], unknown: [] });
		first.stop();
		return stored.replace(/\s+/g, ' ').trim();
	});

	await step('viewer-cannot-select, and the preview needs artifacts.read', async () => {
		const signer = new Signer();
		const context = await serve(seed, new Access(vectors.verifier));
		const viewer = signer.grant('grt_sel0001', ['inspect.read', 'artifacts.read']);
		const editor = signer.grant('grt_sel0002', ['files.read', 'files.write']);

		assert.equal((await context.call('GET', '/development/selection', { grant: viewer })).status, 200);
		const refused = await context.call('PUT', '/development/selection', { grant: viewer, body: '{}' });
		assert.deepEqual([refused.status, refused.body.error.code], [403, 'GRANT_CAPABILITY']);
		assert.equal((await context.call('GET', '/preview/entry.json', { grant: viewer })).status, 200);
		for (const path of ['/preview/', '/preview/entry.json', '/development/selection']) {
			assert.equal((await context.call('GET', path)).body.error.code, 'GRANT_MALFORMED', path);
			assert.equal((await context.call('GET', path, { grant: editor })).body.error.code, 'GRANT_CAPABILITY', path);
		}
		context.stop();
	});

	await step('preview-routes-selected-to-environment: relative addresses, the CDN at exact versions, and the truth without a CDN (stub delivery)', async () => {
		const development = 'target=browser&format=esm&env=development&min=false&sourcemap=inline&types=false&css=false';
		const published = 'target=browser&format=esm&env=production&min=true&sourcemap=external&types=false&css=false';

		delete process.env.BEYOND_CDN_ORIGIN;
		const without = await serve(seed);
		const unset = (await without.call('GET', '/preview/entry.json')).body;
		assert.deepEqual(unset.entry, { specifier: '@case/app/main', vspecifier: '@case/app@1.0.0/main' });
		assert.deepEqual(unset.modules.find(({ specifier }) => specifier === '@case/app/main'),
			{ specifier: '@case/app/main', source: 'environment', version: '1.0.0', vspecifier: '@case/app@1.0.0/main', url: `../m/@case/app@1.0.0/modules/main?${development}` });
		const runtime = unset.modules.find(({ specifier }) => specifier === '@beyond-js/kernel/bundle');
		assert.deepEqual([runtime.source, runtime.version, runtime.url], ['unresolved', kernel, undefined]);
		assert.ok(unset.cdn.reason.includes('BEYOND_CDN_ORIGIN') && !unset.cdn.origin);
		assert.deepEqual(unset.diagnostics.map(({ code }) => code), ['PREVIEW_CDN_UNSET']);
		assert.deepEqual(Object.keys(unset.importmap.imports), ['@case/app/main']);
		assert.ok(unset.updates.reason && !unset.updates.runtime, 'The Kernel has no development coordinator here: nothing claims updates');
		without.stop();

		process.env.BEYOND_CDN_ORIGIN = 'https://cdn.example.test/';
		const context = await serve(seed);
		delete process.env.BEYOND_CDN_ORIGIN;
		const entry = (await context.call('GET', '/preview/entry.json?entry=@case/app/main')).body;
		assert.equal(entry.importmap.imports['@beyond-js/kernel/bundle'], `https://cdn.example.test/m/@beyond-js/kernel@${kernel}/modules/bundle?${published}`);
		assert.deepEqual(entry.diagnostics, []);
		assert.ok(entry.updates.reason && !entry.updates.runtime && !entry.importmap.imports['@beyond-js/kernel/main'],
			'The Kernel exports no development coordinator, so none is asked of the CDN either');

		const html = (await context.call('GET', '/preview/')).body;
		assert.ok(html.includes('<script type="importmap">') && html.includes('await import("@case/app/main");'));
		assert.ok(!/127\.0\.0\.1|localhost|authorization|Bearer/i.test(html), 'The document names neither this service nor a credential');
		assert.equal((await context.call('GET', '/preview/entry.json?entry=@case/none')).body.error.code, 'PREVIEW_ENTRY_NOT_FOUND');
		context.stop();
		return `Kernel ${kernel} resolved from the installation`;
	});

	await step('visitor-stream-has-no-source-events', async () => {
		const signer = new Signer();
		const context = await serve(seed, new Access(vectors.verifier));
		const visitor = await context.subscribe({ grant: signer.grant('grt_vis0001', ['events.subscribe', 'artifacts.read']) });
		const member = await context.subscribe({ grant: signer.grant('grt_mem0001', ['files.read', 'events.subscribe']) });
		await until(() => visitor.messages.length && member.messages.length, 'both subscriptions');

		context.project.write('app/main/index.ts', 'export const v = 3;');
		await until(() => visitor.messages.some(({ event }) => event === 'build.ended'), 'the build to reach the visitor');
		assert.ok(member.messages.some(({ event }) => event === 'file.changed'));
		assert.deepEqual(visitor.messages.filter(({ event }) => /^(file|batch)\./.test(event)), []);
		visitor.close();
		member.close();
		context.stop();
	});
}
