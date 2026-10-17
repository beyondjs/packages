/**
 * The inline map of a module built for Node maps a position of its code to the source file, line and column a
 * stack trace must name (DEV-04): every source by its absolute path, and the expression that throws in
 * `lib/math.ts` at line 3. The workspace is a copy of `fixtures/workspace`; read the README of the fixtures.
 *
 * ```sh
 * BEE_URL=<implementation> node --import "$BEE_NODE_DIR/register.mjs" --test tests/maps/maps.test.mjs
 * ```
 */
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { cp, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { Workspace } from '@beyond-js/packages/workspace';
import { Delivery } from '@beyond-js/packages/artifacts';

const { SourceMapConsumer } = createRequire(import.meta.url)('source-map');
const FIXTURES = fileURLToPath(new URL('./fixtures/workspace', import.meta.url));

let root, workspace, delivery;
before(async () => {
	root = await realpath(await mkdtemp(join(tmpdir(), 'beyond-maps-')));
	await cp(FIXTURES, root, { recursive: true });
	workspace = new Workspace(root);
	delivery = new Delivery(workspace);
});
after(async () => {
	workspace?.destroy();
	root && (await rm(root, { recursive: true, force: true }));
});

/**
 * The code of `./math` for a platform with its inline map, within a bounded wait
 */
const compiled = async platform => {
	let timer;
	const limit = new Promise((_, reject) => (timer = setTimeout(() => reject(new Error('./math never answered')), 60000)));
	try {
		const { delivered, failure } = await Promise.race([delivery.module({ name: '@fixture/maps', version: '1.0.0', subpath: './math' }, { platform, environment: 'development' }), limit]);
		assert.equal(failure, undefined, JSON.stringify(failure));
		const code = delivered.code('inline');
		const [, encoded] = /\/\/# sourceMappingURL=data:application\/json;(?:charset=[^;,]+;)?base64,([A-Za-z0-9+/=]+)\s*$/.exec(code);
		return { code, map: JSON.parse(Buffer.from(encoded, 'base64').toString('utf8')) };
	} finally {
		clearTimeout(timer);
	}
};

/**
 * The one-based line and zero-based column of the first occurrence of a text in the code
 */
const position = (code, text) => {
	const lines = code.split('\n');
	const line = lines.findIndex(content => content.includes(text));
	return { line: line + 1, column: lines[line].indexOf(text) };
};

for (const platform of ['node', 'web']) {
	test(`the ${platform} map names every source by its absolute path`, async () => {
		const { map } = await compiled(platform);
		assert.deepEqual([...map.sources].sort(), [join(root, 'app/lib/format.ts'), join(root, 'app/lib/math.ts')]);
		assert.ok(!map.sourceRoot);
	});

	test(`the ${platform} map maps the expression that throws to lib/math.ts, line 3`, async () => {
		const { code, map } = await compiled(platform);
		const consumer = await new SourceMapConsumer(map);
		const original = consumer.originalPositionFor(position(code, 'new Error('));
		assert.deepEqual([original.source, original.line, original.column], [join(root, 'app/lib/math.ts'), 3, 7], JSON.stringify(original));
		consumer.destroy?.();
	});
}
