/**
 * Visibility belongs to each release, not to the credential: a registry release read with a credential is
 * public only when an anonymous probe finds the same release and its archive, and any doubt keeps it private.
 * Every request of a resolution goes through the transport the consumer injects.
 */
import assert from 'node:assert/strict';
import { Resolution } from '@beyond-js/packages/resolution';
import { FakeRegistry } from './registry.mjs';
import { step, valid } from './harness.mjs';

const TOKEN = 'npm_VISIBILITYtoken0123456789';

export async function visibility({ registry, documents }) {
	const mixed = await new FakeRegistry({ prefix: '/mixed/npm', token: TOKEN, open: ['@acme/open', '@acme/sealed', '@acme/skewed'] }).start();
	await mixed.publish({ name: '@acme/open', version: '1.0.0', dependencies: { 'diamond-base': '^2.0.0' } });
	await mixed.publish({ name: '@acme/sealed', version: '1.0.0' });
	await mixed.publish({ name: '@acme/skewed', version: '1.0.0' });
	await mixed.publish({
		name: '@acme/closed',
		version: '1.0.0',
		dependencies: { '@acme/open': '^1.0.0', '@acme/sealed': '1.0.0', '@acme/skewed': '1.0.0' }
	});
	mixed.seal('@acme/sealed');
	mixed.skew('@acme/skewed', '1.0.0');

	const providers = extra => ({
		values: { default: { registry: registry.url }, scopes: { '@acme': { registry: mixed.url, auth: { mode: 'token', token: TOKEN } } } },
		...extra
	});
	const pin = async params => {
		const document = await Resolution.pin({ tenant: 'acme', ...params });
		documents.push(document);
		return document;
	};
	const node = (document, name) => Object.values(document.nodes).find(node => node.name === name);

	try {
		await step('visibility: a public package read with a token is public and fetched without it', async () => {
			registry.reset();
			mixed.reset();
			const document = await pin({ roots: { '@acme/closed': '1.0.0' }, providers: providers() });
			assert.ok(valid(document), JSON.stringify(document.diagnostics));

			const closed = node(document, '@acme/closed');
			const open = node(document, '@acme/open');
			assert.deepEqual([closed.visibility, closed.access], ['private', 'credential']);
			assert.deepEqual([open.visibility, open.access], ['public', 'anonymous']);
			assert.equal(open.origin.provider, closed.origin.provider, 'one registry, two visibilities');

			// A release read without a credential is public and carries no evidence of a probe
			const base = node(document, 'diamond-base');
			assert.deepEqual([base.visibility, base.access], ['public', undefined]);

			// The probe of the open package asked for its document and its archive, without the credential
			const anonymous = mixed.log.filter(({ credential }) => !credential);
			assert.ok(anonymous.some(({ type, path }) => type === 'tarball' && path.includes('/@acme/open/-/')));
			assert.ok(anonymous.every(({ type }) => type === 'packument' || type === 'tarball'));
			assert.ok(registry.log.every(({ credential }) => !credential), 'a credential reached the public registry');
			return `${anonymous.length} anonymous probe requests`;
		});

		await step('visibility: any doubt keeps a release read with a token private', async () => {
			const document = await pin({ roots: { '@acme/closed': '1.0.0' }, providers: providers() });
			assert.ok(valid(document), JSON.stringify(document.diagnostics));

			// Anonymous metadata but an archive behind the token; another integrity for anonymous clients
			for (const name of ['@acme/sealed', '@acme/skewed']) {
				const found = node(document, name);
				assert.deepEqual([found.visibility, found.access], ['private', 'credential'], name);
			}
		});

		await step('transport: every request of a resolution goes through the injected fetch, and a refusal is a diagnostic', async () => {
			const seen = [];
			const fetch = (url, init) => (seen.push(url), globalThis.fetch(url, init));
			const document = await pin({ roots: { '@acme/closed': '1.0.0' }, providers: providers({ fetch }) });
			assert.ok(valid(document), JSON.stringify(document.diagnostics));
			assert.ok(seen.some(url => url.startsWith(mixed.url)) && seen.some(url => url.startsWith(registry.url)));

			const refuse = url => Promise.reject(Object.assign(new Error(`The destination of ${new URL(url).host} is refused`), { code: 'DESTINATION_REFUSED' }));
			const refused = await pin({ roots: { '@acme/closed': '1.0.0' }, providers: providers({ fetch: refuse }) });
			assert.equal(valid(refused), false);
			assert.ok(refused.diagnostics.some(({ code }) => code === 'DESTINATION_REFUSED'), JSON.stringify(refused.diagnostics));
		});
	} finally {
		await mixed.stop();
	}
}
