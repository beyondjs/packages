/**
 * The documents the resolution returns against the `beyond-graph/1` schema of the CDN contracts. The
 * contracts are located through configuration: `CDN_CONTRACTS_DIR`, or `CDN_DIR` (its `contracts`
 * directory). Without either, the check is skipped and says so: no sibling checkout is assumed.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { step, valid } from './harness.mjs';

/**
 * Canonical JSON written independently of the implementation, as the contract states it: members sorted
 * by key, no insignificant whitespace
 */
const canonical = value => {
	if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
	if (!value || typeof value !== 'object') return JSON.stringify(value);
	return `{${Object.keys(value)
		.sort()
		.map(key => `${JSON.stringify(key)}:${canonical(value[key])}`)
		.join(',')}}`;
};

const location = () => {
	const { CDN_CONTRACTS_DIR, CDN_DIR } = process.env;
	if (CDN_CONTRACTS_DIR) return resolve(CDN_CONTRACTS_DIR);
	return CDN_DIR ? join(resolve(CDN_DIR), 'contracts') : void 0;
};

/**
 * @param documents Every document the run obtained, valid or not
 */
export async function contract({ documents }) {
	await step('contract: every document carries the digest of its canonical form, closed over its nodes', async () => {
		assert.ok(documents.length > 20);
		for (const { digest, ...document } of documents) {
			assert.equal(digest, `sha256-${createHash('sha256').update(canonical(document)).digest('hex')}`);

			const excepted = new Set(document.exceptions.map(({ node }) => node));
			for (const [key, node] of Object.entries(document.nodes)) {
				assert.ok(key.endsWith(`:${node.name}@${node.version}`), key);
				assert.ok(node.integrity !== null || excepted.has(key), `${key} has no integrity and is no exception`);
			}
			for (const { from, to, context, kind } of document.edges) {
				assert.ok(document.nodes[from], from);
				to !== null && assert.ok(document.nodes[to], to);
				assert.equal(kind === 'peer', !!context);
				context && assert.ok(document.nodes[context], context);
			}
			for (const { node } of document.roots) node && assert.ok(document.nodes[node], node);
		}
		return `${documents.length} documents`;
	});

	const directory = location();
	if (!directory) {
		console.log('SKIP contract: schema validation — set CDN_CONTRACTS_DIR or CDN_DIR to the CDN contracts');
		return;
	}

	await step('contract: every usable graph validates against the beyond-graph/1 schema', async () => {
		const schema = JSON.parse(await readFile(join(directory, 'graph', 'schema.json'), 'utf8'));
		const { default: Ajv } = await import('ajv/dist/2020.js');
		const ajv = new (Ajv.default || Ajv)({ allErrors: true, strict: false, validateFormats: false });
		ajv.addSchema(schema);
		const validate = ajv.getSchema(`${schema.$id}#/$defs/graph`);

		const usable = documents.filter(valid);
		assert.ok(usable.length > 15);
		for (const document of usable) {
			const ok = validate(document);
			assert.ok(ok, `${JSON.stringify(document.roots)}: ${ajv.errorsText(validate.errors)}`);
		}

		// A graph that could not be pinned is returned with its diagnostics. The schema requires every
		// root to have a node and at least one node, so such a document cannot validate: it is counted
		// here as evidence, not asserted
		const unusable = documents.filter(document => !valid(document));
		const conforming = unusable.filter(document => validate(document)).length;
		return `${usable.length} usable graphs validate; ${conforming}/${unusable.length} failed resolutions also do`;
	});
}
