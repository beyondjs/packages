/**
 * Private packages: credentials, the scope a source is stored in (it follows the node, not the credential),
 * and who can find it afterwards; git and archive URL sources; the injected transport.
 */
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { Resolution } from '@beyond-js/packages/resolution';
import { Sources, FilesystemStore } from '@beyond-js/packages/sources';
import { PackageProviders } from '@beyond-js/packages/providers';
import { FakeRegistry } from '../cdn-resolution/registry.mjs';
import { Forge } from '../cdn-resolution/forge.mjs';
import { step, valid } from '../cdn-resolution/harness.mjs';

const TOKEN = 'npm_SECRETtokenA1B2C3';
const COMMIT = '89abcdef0123456789abcdef0123456789abcdef';
const OTHER = 'fedcba9876543210fedcba9876543210fedcba98';

export async function tenancy({ registry, store, staged }) {
	const restricted = await new FakeRegistry({ prefix: '/private/npm', token: TOKEN }).start();
	await restricted.publish({ name: '@acme/ui', version: '2.0.0', dependencies: { 'app-core': '^1.0.0' } });

	const settings = token => ({
		user: false,
		global: false,
		env: false,
		values: {
			default: { registry: registry.url },
			scopes: { '@acme': { registry: restricted.url, auth: token && { mode: 'token', token } } }
		}
	});
	const outputs = [];

	try {
		const graph = await Resolution.pin({
			roots: { '@acme/ui': '2.0.0' },
			providers: settings(TOKEN),
			tenant: 'acme'
		});
		assert.ok(valid(graph), JSON.stringify(graph.diagnostics));
		const [key, node] = Object.entries(graph.nodes).find(([, node]) => node.name === '@acme/ui');
		const record = scope => ({
			key: '',
			scope,
			origin: node.origin.provider,
			name: node.name,
			version: node.version,
			integrity: node.integrity
		});

		await step(
			'authentication: a private archive without credentials is a diagnostic and stores nothing',
			async () => {
				const anonymous = await Sources.fetch(graph, store, {}, 'acme');
				outputs.push(JSON.stringify(anonymous));
				assert.equal(anonymous.complete, false);
				assert.deepEqual(
					anonymous.diagnostics.map(({ code, node }) => [code, node]),
					[['PROVIDER_AUTH_REQUIRED', key]]
				);
				assert.equal(await store.has(record('org:acme')), false);

				const wrong = await Sources.fetch(
					graph,
					store,
					{},
					'acme',
					new PackageProviders(settings('npm_WRONGtoken'))
				);
				outputs.push(JSON.stringify(wrong));
				assert.deepEqual(
					wrong.diagnostics.map(({ code }) => code),
					['PROVIDER_AUTH_REQUIRED']
				);
				assert.deepEqual(await staged(), []);
			}
		);

		await step('scope: a private source is stored for its tenant and never as public', async () => {
			const orphan = await Sources.fetch(graph, store, {}, undefined, new PackageProviders(settings(TOKEN)));
			assert.deepEqual(
				orphan.diagnostics.map(({ code }) => code),
				['TENANT_REQUIRED']
			);

			restricted.reset();
			const report = await Sources.fetch(graph, store, {}, 'acme', new PackageProviders(settings(TOKEN)));
			outputs.push(JSON.stringify(report));
			assert.equal(report.complete, true, JSON.stringify(report.diagnostics));
			assert.deepEqual(report.packages.map(({ node, scope }) => [node.split(':')[1], scope]).sort(), [
				['@acme/ui@2.0.0', 'org:acme'],
				['app-core@1.0.3', 'public']
			]);
			assert.ok(restricted.log.every(({ authorized }) => authorized));
			assert.ok(
				registry.log.every(({ credential }) => !credential),
				'a credential reached the public registry'
			);

			assert.equal(await store.has(record('org:acme')), true);
			assert.equal(await store.has(record('public')), false);
			assert.equal(await store.has(record('org:globex')), false);
		});

		await step('tenants: another tenant never reuses the private source of the first', async () => {
			const stranger = await Sources.fetch(graph, store, {}, 'globex', new PackageProviders(settings()));
			outputs.push(JSON.stringify(stranger));
			assert.deepEqual(
				stranger.diagnostics.map(({ code }) => code),
				['PROVIDER_AUTH_REQUIRED']
			);
			assert.equal(await store.has(record('org:globex')), false);

			// An authorized tenant downloads its own copy; the first tenant still reuses its own
			restricted.reset();
			const partner = await Sources.fetch(graph, store, {}, 'globex', new PackageProviders(settings(TOKEN)));
			assert.equal(partner.packages.find(({ node }) => node === key).reused, false);
			assert.equal(restricted.requests.tarball, 1);
			const owner = await Sources.fetch(graph, store, {}, 'acme', new PackageProviders(settings(TOKEN)));
			assert.equal(owner.packages.find(({ node }) => node === key).reused, true);
		});

		await step('the node decides: a node the graph calls public is downloaded without any credential', async () => {
			// A private release forged public is requested anonymously, refused, and nothing is stored
			const forged = JSON.parse(JSON.stringify(graph));
			forged.nodes[key].visibility = 'public';
			restricted.reset();
			const report = await Sources.fetch(forged, store, {}, 'initech', new PackageProviders(settings(TOKEN)));
			outputs.push(JSON.stringify(report));
			assert.deepEqual(report.diagnostics.map(({ code, node }) => [code, node]), [['PROVIDER_AUTH_REQUIRED', key]]);
			assert.ok(restricted.log.length && restricted.log.every(({ credential }) => !credential), 'a credential reached the archive of a public node');
			assert.equal(await store.has(record('public')), false);
			assert.equal(await store.has(record('org:initech')), false);
		});

		await step('the node decides: a public package of an authenticated registry is fetched anonymously and stored as public', async () => {
			const mixed = await new FakeRegistry({ prefix: '/mixed/npm', token: TOKEN, open: ['@mixed/open'] }).start();
			try {
				await mixed.publish({ name: '@mixed/open', version: '1.0.0' });
				await mixed.publish({ name: '@mixed/closed', version: '1.0.0', dependencies: { '@mixed/open': '1.0.0' } });
				const values = { default: { registry: registry.url }, scopes: { '@mixed': { registry: mixed.url, auth: { mode: 'token', token: TOKEN } } } };
				const options = { user: false, global: false, env: false, values };
				const pinned = await Resolution.pin({ roots: { '@mixed/closed': '1.0.0' }, providers: options, tenant: 'acme' });
				assert.ok(valid(pinned), JSON.stringify(pinned.diagnostics));

				mixed.reset();
				const report = await Sources.fetch(pinned, store, {}, 'acme', new PackageProviders(options));
				outputs.push(JSON.stringify(report));
				assert.equal(report.complete, true, JSON.stringify(report.diagnostics));
				const scopes = Object.fromEntries(report.packages.map(({ node, scope }) => [pinned.nodes[node].name, scope]));
				assert.deepEqual(scopes, { '@mixed/closed': 'org:acme', '@mixed/open': 'public' });

				// Each archive was requested as its node says: the public one without the credential
				const archives = mixed.log.filter(({ type }) => type === 'tarball');
				assert.deepEqual(archives.map(({ path, credential }) => [path.split('/-/')[0].split('/').slice(-2).join('/'), credential]).sort(), [
					['@mixed/closed', true],
					['@mixed/open', false]
				]);
			} finally {
				await mixed.stop();
			}
		});

		await step('secrets: no credential appears in any report', async () => {
			const text = outputs.join('\n');
			assert.ok(text.length > 300);
			for (const secret of [TOKEN, 'npm_WRONGtoken', 'Bearer', 'uthorization']) {
				assert.ok(!text.includes(secret), `"${secret}" appears in a report`);
			}
		});

		await step('exceptions: a git release without published integrity gets one established at fetch', async () => {
			const forge = await new Forge().start();
			try {
				const manifest = { name: '@acme/widgets', version: '3.0.0' };
				forge.repository('acme/widgets', {
					commits: { [COMMIT]: { manifest, files: { 'index.js': 'export default 3;' } }, [OTHER]: { manifest, files: { 'index.js': 'export default 4;' } } },
					branches: { main: OTHER }
				});
				const options = { ...settings(), forges: { [forge.host]: 'gitlab' } };
				const pin = ref => Resolution.pin({ roots: { widgets: `git+http://${forge.host}/acme/widgets.git#${ref}` }, providers: options });
				const pinned = await pin(COMMIT);
				assert.ok(valid(pinned), JSON.stringify(pinned.diagnostics));

				const report = await Sources.fetch(pinned, store);
				assert.equal(report.complete, true, JSON.stringify(report.diagnostics));
				const [result] = report.packages;
				assert.equal(result.established, true);
				assert.match(result.integrity, /^sha512-/);
				assert.equal(forge.requests.archive, 1);
				assert.equal((await Sources.fetch(pinned, store)).packages[0].reused, true);

				// Another commit with the same manifest name and version is another source, never the first one reused
				const branch = await pin('main');
				assert.ok(valid(branch), JSON.stringify(branch.diagnostics));
				const second = await Sources.fetch(branch, store);
				assert.deepEqual([second.complete, second.packages[0].reused], [true, false]);
				assert.notEqual(second.packages[0].integrity, result.integrity);
				assert.equal(forge.requests.archive, 2);

				// The same node outside the recorded exceptions is refused
				const unlisted = { ...pinned, exceptions: [] };
				assert.deepEqual(
					(await Sources.fetch(unlisted, store)).diagnostics.map(({ code }) => code),
					['INTEGRITY_MISSING']
				);
			} finally {
				await forge.stop();
			}
		});

		await step('archive URLs: a pinned digest is verified at fetch, with or without a declared integrity', async () => {
			const release = registry.release('app-core', '1.0.3');
			const url = `${registry.url}/app-core/-/app-core-1.0.3.tgz`;
			for (const spec of [`${url}#${release.integrity}`, url]) {
				const pinned = await Resolution.pin({ roots: { archived: spec }, providers: settings() });
				assert.ok(valid(pinned), JSON.stringify(pinned.diagnostics));
				const [node] = Object.keys(pinned.nodes);
				assert.match(node, /^digest:sha512-[0-9a-f]{128}$/);

				const report = await Sources.fetch(pinned, store);
				assert.equal(report.complete, true, JSON.stringify(report.diagnostics));
				assert.deepEqual([report.packages[0].scope, report.packages[0].integrity], ['public', release.integrity]);
			}

			// Content that changed after it was pinned is refused
			const pinned = await Resolution.pin({ roots: { archived: url }, providers: settings() });
			registry.fault('app-core', '1.0.3', registry.release('app-extra', '2.0.0').bytes);
			try {
				const fresh = new FilesystemStore(join(store.root, '..', 'digest-store'));
				const report = await Sources.fetch(pinned, fresh);
				assert.deepEqual(report.diagnostics.map(({ code }) => code), ['INTEGRITY_MISMATCH']);
			} finally {
				registry.fault('app-core', '1.0.3');
			}
		});

		await step('transport: archives are requested through the injected fetch, and a refused destination stores nothing', async () => {
			const pinned = await Resolution.pin({ roots: { 'app-extra': '2.0.0' }, providers: settings() });
			const fresh = new FilesystemStore(join(store.root, '..', 'transport-store'));
			const refuse = url => Promise.reject(Object.assign(new Error(`${new URL(url).host} is not a permitted destination`), { code: 'DESTINATION_REFUSED' }));
			const refused = await Sources.fetch(pinned, fresh, {}, void 0, void 0, refuse);
			assert.deepEqual([...new Set(refused.diagnostics.map(({ code }) => code))], ['DESTINATION_REFUSED']);
			assert.equal(refused.packages.length, 0);

			const seen = [];
			const passing = (url, init) => (seen.push(url), fetch(url, init));
			const report = await Sources.fetch(pinned, fresh, {}, void 0, void 0, passing);
			assert.equal(report.complete, true, JSON.stringify(report.diagnostics));
			assert.equal(seen.length, Object.keys(pinned.nodes).length);
		});
	} finally {
		await restricted.stop();
	}
}
