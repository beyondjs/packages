/**
 * What a fetch leaves in the store when everything is fine: every package of the graph, verified,
 * fetched once, and usable after the origin is gone.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Sources } from '@beyond-js/packages/sources';
import { step } from '../cdn-resolution/harness.mjs';

export async function fetching({ registry, pin, store, staged }) {
	const graph = await pin({ roots: { 'app-shell': '1.0.0' } });

	await step('whole graph: every missing package is fetched and verified before the call returns', async () => {
		registry.reset();
		const report = await Sources.fetch(graph, store);
		assert.deepEqual(report.diagnostics, []);
		assert.equal(report.complete, true);
		assert.equal(report.graph, graph.digest);
		assert.deepEqual(
			report.packages.map(({ node }) => node),
			Object.keys(graph.nodes).sort()
		);
		assert.equal(registry.requests.tarball, 3);

		for (const result of report.packages) {
			const node = graph.nodes[result.node];
			assert.equal(result.reused, false);
			assert.equal(result.scope, 'public');
			assert.equal(result.integrity, node.integrity);
			assert.equal(result.bytes, registry.release(node.name, node.version).bytes.length);
			assert.ok(result.key.startsWith(`${node.origin.provider}/${node.name}/${node.version}/sha512-`));

			const stored = await store.get({
				...result,
				origin: node.origin.provider,
				name: node.name,
				version: node.version
			});
			const manifest = JSON.parse(await readFile(join(stored.location, 'package.json'), 'utf8'));
			assert.equal(`${manifest.name}@${manifest.version}`, `${node.name}@${node.version}`);
			assert.equal(
				stored.extracted,
				Object.values(stored.files).reduce((total, size) => total + size, 0)
			);
		}

		const ui = report.packages.find(({ node }) => node.includes(':app-ui@'));
		const stored = await store.get({
			...ui,
			origin: graph.nodes[ui.node].origin.provider,
			name: 'app-ui',
			version: '1.1.0'
		});
		assert.deepEqual(Object.keys(stored.files).sort(), ['index.js', 'package.json', 'styles/main.css']);
		assert.deepEqual(await staged(), []);
		return `${report.packages.length} packages, ${registry.requests.tarball} downloads`;
	});

	await step('reuse: a verified source is reused without downloading', async () => {
		registry.reset();
		const report = await Sources.fetch(graph, store);
		assert.equal(report.complete, true);
		assert.ok(report.packages.every(({ reused }) => reused));
		assert.equal(registry.requests.tarball, 0);
		assert.equal(registry.requests.packument + registry.requests.manifest, 0);

		// A larger graph only downloads what is missing
		const larger = await pin({ roots: { 'app-shell': '1.0.0', 'app-extra': '2.0.0' } });
		registry.reset();
		const partial = await Sources.fetch(larger, store);
		assert.equal(partial.complete, true);
		assert.deepEqual(
			partial.packages.filter(({ reused }) => !reused).map(({ node }) => node.split(':')[1]),
			['app-extra@2.0.0']
		);
		assert.equal(registry.requests.tarball, 1);
	});

	await step('durability: retained sources work after the origin is lost', async () => {
		for (const { name, version } of Object.values(graph.nodes)) registry.fault(name, version, 'unavailable');
		try {
			const report = await Sources.fetch(graph, store);
			assert.equal(report.complete, true);
			assert.ok(report.packages.every(({ reused }) => reused));
		} finally {
			for (const { name, version } of Object.values(graph.nodes)) registry.fault(name, version);
		}
	});

	await step('graph: a document with errors, or that is no graph, is not fetched', async () => {
		const broken = await pin({ roots: { 'app-shell': '1.0.0', 'not-published': '1.0.0' } });
		registry.reset();
		const report = await Sources.fetch(broken, store);
		assert.equal(report.complete, false);
		assert.deepEqual(
			report.diagnostics.map(({ code }) => code),
			['GRAPH_INVALID']
		);
		assert.equal(registry.requests.tarball, 0);

		const foreign = await Sources.fetch({ protocol: 'other/1', nodes: {} }, store);
		assert.deepEqual(
			foreign.diagnostics.map(({ code }) => code),
			['GRAPH_INVALID']
		);
	});
}
