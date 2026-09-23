/**
 * Writes that follow each other closely: a source broken, and corrected as soon as the state of the service
 * reports the failure. It is what a person saving a correction, or an editor and a Workspace environment that
 * poll `GET /state`, do. The failure is reported within milliseconds of the first write, so the correction
 * lands inside the window in which the filesystem watcher reports one change of a path (50 ms for
 * chokidar); a correction dropped there used to stay unbuilt, and the module kept the diagnostic of the
 * broken source, until an unrelated later edit of the same file.
 *
 * The workspace is `fixtures/writes`, watched by the real watchers service; read its README.
 *
 * ```sh
 * BEE_URL=<implementation>[,<utility>…] WATCHERS_URL=<watchers> BEYOND_ROUNDS=30 \
 *   node --import "$BEE_NODE_DIR/register.mjs" --test tests/development/writes.test.mjs
 * ```
 *
 * `BEYOND_ROUNDS` (5 by default) is how many times each source is broken and corrected: the loss depended on
 * timing, and one passing round is not evidence of a repair.
 */
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { readFile, writeFile } from 'node:fs/promises';
import { WatchersService } from '@beyond-js/packages/watchers';
import { Watched } from './support/watched.mjs';

const { WATCHERS_URL } = process.env;
if (!WATCHERS_URL) throw new Error('Set WATCHERS_URL to the Engine server that serves the watchers utility.');

const rounds = Number(process.env.BEYOND_ROUNDS ?? 5);
if (!Number.isInteger(rounds) || rounds < 1) throw new Error('BEYOND_ROUNDS must be a whole number of rounds, at least 1');

const VIEW = '@fixture/writes/view';
const service = new WatchersService('watchers', { env: { BEE_URL: WATCHERS_URL } });
before(() => service.start());
after(() => service.stop());

/**
 * Breaks a source, waits for the state to report it, writes the correction at once and waits for the state
 * to report the module valid again, as many times as the rounds say
 *
 * @returns {Promise<string[]>} The codes of the failures that were reported
 */
async function correct(watched, path, broken) {
	const file = watched.file(path);
	const good = await readFile(file, 'utf8');
	await watched.until(VIEW, 'valid', 'the module before any edit');

	const codes = [];
	for (let round = 1; round <= rounds; round++) {
		await writeFile(file, broken(good));
		const failed = await watched.until(VIEW, 'invalid', `round ${round}: the broken ${path}`);
		codes.push(...failed.diagnostics.map(({ code }) => code));

		await writeFile(file, good);
		const restored = await watched.until(VIEW, 'valid', `round ${round}: the correction of ${path}, written as soon as the failure was reported`);
		assert.equal(typeof restored.hash, 'string');
	}
	return codes;
}

test('a Vue component corrected as soon as its failure is reported is built again', async t => {
	const watched = await Watched.open(t, 'writes');
	const codes = await correct(watched, 'ui/view/view.vue', source => source.replace('</template>', '<div></template>'));
	assert.equal(codes.length, rounds, 'each round reported the failure once');
	assert.ok(codes.every(code => code === 'VUE_PARSE_ERROR'), codes.join(', '));
});

test('a stylesheet corrected as soon as its failure is reported is built again', async t => {
	const watched = await Watched.open(t, 'writes');
	const codes = await correct(watched, 'ui/view/view.css', source => `${source}\n.broken { color: \n`);
	assert.equal(codes.length, rounds, 'each round reported the failure once');
	assert.ok(codes.every(code => /STYLE/.test(code)), codes.join(', '));
});
