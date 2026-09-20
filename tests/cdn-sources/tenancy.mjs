/**
 * Private packages: credentials, the scope a source is stored in, and who can find it afterwards.
 */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { Resolution } from '@beyond-js/packages/resolution';
import { Sources } from '@beyond-js/packages/sources';
import { PackageProviders } from '@beyond-js/packages/providers';
import { FakeRegistry, archive } from '../cdn-resolution/registry.mjs';
import { step, valid } from '../cdn-resolution/harness.mjs';

const TOKEN = 'npm_SECRETtokenA1B2C3';
const COMMIT = '89abcdef0123456789abcdef0123456789abcdef';

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

		await step(
			'credentials decide: what is downloaded with a credential is private whatever the graph says',
			async () => {
				const forged = JSON.parse(JSON.stringify(graph));
				forged.nodes[key].visibility = 'public';
				const report = await Sources.fetch(forged, store, {}, 'initech', new PackageProviders(settings(TOKEN)));
				assert.equal(report.packages.find(({ node }) => node === key).scope, 'org:initech');
				assert.equal(await store.has(record('public')), false);
			}
		);

		await step('secrets: no credential appears in any report', async () => {
			const text = outputs.join('\n');
			assert.ok(text.length > 300);
			for (const secret of [TOKEN, 'npm_WRONGtoken', 'Bearer', 'uthorization']) {
				assert.ok(!text.includes(secret), `"${secret}" appears in a report`);
			}
		});

		await step('exceptions: a release without published integrity gets one established at fetch', async () => {
			const bytes = await archive([
				{
					name: 'widgets-main/package.json',
					content: JSON.stringify({ name: '@acme/widgets', version: '3.0.0' })
				},
				{ name: 'widgets-main/index.js', content: 'export default 3;' }
			]);
			const server = createServer((request, response) => {
				if (request.url.endsWith('/package.json'))
					return response.end(JSON.stringify({ name: '@acme/widgets', version: '3.0.0' }));
				response.end(bytes);
			});
			await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));

			try {
				const range = `git+http://127.0.0.1:${server.address().port}/acme/widgets.git#${COMMIT}`;
				const pinned = await Resolution.pin({ roots: { widgets: range }, providers: settings() });
				assert.ok(valid(pinned), JSON.stringify(pinned.diagnostics));

				const report = await Sources.fetch(pinned, store);
				assert.equal(report.complete, true, JSON.stringify(report.diagnostics));
				const [result] = report.packages;
				assert.equal(result.established, true);
				assert.match(result.integrity, /^sha512-/);
				assert.equal((await Sources.fetch(pinned, store)).packages[0].reused, true);

				// The same node outside the recorded exceptions is refused
				const unlisted = { ...pinned, exceptions: [] };
				assert.deepEqual(
					(await Sources.fetch(unlisted, store)).diagnostics.map(({ code }) => code),
					['INTEGRITY_MISSING']
				);
			} finally {
				await new Promise(resolve => server.close(resolve));
			}
		});
	} finally {
		await restricted.stop();
	}
}
