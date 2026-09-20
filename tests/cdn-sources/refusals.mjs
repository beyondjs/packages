/**
 * What a fetch refuses, and what it leaves behind when it does: nothing. Each case also fetches a healthy
 * package in the same graph, which must be stored all the same.
 */
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { Sources } from '@beyond-js/packages/sources';
import { step } from '../cdn-resolution/harness.mjs';

export async function refusals({ registry, pin, store, staged }) {
	/**
	 * Fetches a graph of the package under test plus a healthy one, and checks that only the refusal is
	 * missing from the store
	 */
	const refused = async (name, code, { limits, fault } = {}) => {
		const graph = await pin({ roots: { [name]: '1.0.0', 'app-core': '^1.0.0' } });
		const [key, node] = Object.entries(graph.nodes).find(([, node]) => node.name === name);

		fault !== undefined && registry.fault(name, '1.0.0', fault);
		let report;
		try {
			report = await Sources.fetch(graph, store, limits);
		} finally {
			registry.fault(name, '1.0.0');
		}

		assert.equal(report.complete, false);
		assert.deepEqual(
			report.diagnostics.map(({ code, node }) => [code, node]),
			[[code, key]]
		);
		assert.deepEqual(
			report.packages.map(({ node }) => node.split(':')[1]),
			['app-core@1.0.3']
		);

		const { provider } = node.origin;
		const record = {
			key: '',
			scope: 'public',
			origin: provider,
			name,
			version: '1.0.0',
			integrity: node.integrity
		};
		assert.equal(await store.has(record), false, 'a refused source is in the store');
		assert.equal(await store.get(record), undefined);
		assert.deepEqual(await staged(), [], 'a refused source left a stage behind');
		return report;
	};

	await step('integrity: bytes that are not the published archive are refused', async () => {
		await refused('bulky', 'ARCHIVE_CORRUPT', { fault: 'corrupt' });

		// A well formed archive of something else is only told apart by its digest
		const other = registry.release('app-ui', '1.1.0').bytes;
		const report = await refused('bulky', 'INTEGRITY_MISMATCH', { fault: other });
		assert.match(report.diagnostics[0].message, /sha512/);
	});

	await step('compressed size: an archive over the limit is abandoned, declared or not', async () => {
		registry.reset();
		await refused('bulky', 'ARCHIVE_TOO_LARGE', { limits: { compressed: 64 * 1024 } });
		await refused('bulky', 'ARCHIVE_TOO_LARGE', { limits: { compressed: 64 * 1024 }, fault: 'chunked' });
	});

	await step('extracted size: a decompression bomb is abandoned while it inflates', async () => {
		const { bytes } = registry.release('bomb', '1.0.0');
		assert.ok(bytes.length < 64 * 1024, 'the fixture is not small compressed');
		const report = await refused('bomb', 'EXTRACTED_TOO_LARGE', {
			limits: { compressed: 64 * 1024, extracted: 1024 * 1024 }
		});
		return `${bytes.length} compressed bytes refused: ${report.diagnostics[0].message}`;
	});

	await step('entries: an archive with more entries than allowed is abandoned', async () => {
		await refused('many-entries', 'ENTRIES_LIMIT', { limits: { entries: 20 } });
	});

	await step('entries: traversal, absolute paths and links are refused, and nothing escapes', async () => {
		await refused('traversal', 'ENTRY_UNSAFE');
		await refused('absolute', 'ENTRY_UNSAFE');
		await refused('linked', 'ENTRY_UNSUPPORTED');

		for (const escaped of [
			join(store.root, 'escaped.txt'),
			join(dirname(store.root), 'escaped.txt'),
			'/tmp/beyond-absolute.txt'
		]) {
			await assert.rejects(access(escaped), `${escaped} was written`);
		}
	});

	await step('outage: a transfer cut halfway or an unavailable origin leaves nothing', async () => {
		await refused('bulky', 'DOWNLOAD_FAILED', { fault: 'truncate' });
		await refused('bulky', 'DOWNLOAD_FAILED', { fault: 'unavailable' });

		// Once the origin recovers, the same fetch completes
		const graph = await pin({ roots: { bulky: '1.0.0', 'app-core': '^1.0.0' } });
		const report = await Sources.fetch(graph, store);
		assert.equal(report.complete, true);
		assert.deepEqual(report.packages.map(({ reused }) => reused).sort(), [false, true]);
	});
}
