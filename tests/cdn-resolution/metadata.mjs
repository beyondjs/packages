/**
 * What the resolution requests, and what it never does: it reads package metadata, once per package, and
 * downloads no archive.
 */
import assert from 'node:assert/strict';
import { Resolution } from '@beyond-js/packages/resolution';
import { FakeRegistry } from './registry.mjs';
import { step, valid } from './harness.mjs';

export async function metadata({ registry, pin }) {
	await step('metadata only: one metadata request per package, no manifest and no archive', async () => {
		registry.reset();
		const roots = { 'diamond-top': '1.0.0', 'multi-new': '1.0.0', 'multi-old': '1.0.0', 'cycle-a': '^1.0.0' };
		const document = await pin({ roots });
		assert.ok(valid(document), JSON.stringify(document.diagnostics));

		const names = new Set(Object.values(document.nodes).map(({ name }) => name));
		assert.equal(registry.requests.packument, names.size);
		assert.equal(registry.requests.manifest, 0);
		assert.equal(registry.requests.tarball, 0);
		assert.deepEqual(document.exceptions, []);

		for (const node of Object.values(document.nodes)) {
			assert.equal(node.integrity, registry.release(node.name, node.version).integrity);
			assert.ok(node.tarball.endsWith(`/${node.name}/-/${node.name}-${node.version}.tgz`));
		}
		return `${registry.requests.packument} metadata requests for ${Object.keys(document.nodes).length} nodes`;
	});

	await step('exceptions: a provider without release metadata is recorded per fetched manifest', async () => {
		const bare = await new FakeRegistry({ prefix: '/bare', metadata: 'versions' }).start();
		try {
			await bare.publish({ name: 'bare-top', version: '1.0.0', dependencies: { 'bare-leaf': '^1.0.0' } });
			await bare.publish({ name: 'bare-leaf', version: '1.0.0' });
			await bare.publish({ name: 'bare-leaf', version: '1.1.0' });

			const providers = { values: { default: { registry: bare.url } } };
			const document = await Resolution.pin({ roots: { 'bare-top': '1.0.0' }, providers });
			assert.ok(valid(document), JSON.stringify(document.diagnostics));
			assert.deepEqual(
				document.exceptions.map(({ node, kind }) => `${node.split(':')[1]}:${kind}`),
				['bare-leaf@1.1.0:manifest-fetch', 'bare-top@1.0.0:manifest-fetch']
			);
			for (const { node, provider } of document.exceptions) {
				assert.equal(document.nodes[node].origin.provider, provider);
				assert.match(document.nodes[node].integrity, /^sha512-/);
			}
			assert.equal(bare.requests.manifest, 2);
			assert.equal(bare.requests.tarball, 0);
		} finally {
			await bare.stop();
		}
	});
}
