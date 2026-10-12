import { cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const FIXTURES = fileURLToPath(new URL('../fixtures/', import.meta.url));

/**
 * A copy of a fixture of `tests/production/fixtures` in a unique temporary directory whose path holds a space, removed
 * when the case ends (also when it fails), once what the case gave to `settle` has settled, such as the operations that
 * still write their records. The checked-in files are never written: what a fixture cannot hold (a file Git ignores,
 * such as `.env`) is written into the copy by the case, with `write`.
 *
 * ```js
 * const { root, write, settle } = copy(t, 'packages');
 * write('packages/ui/.env', 'NOT_A_REAL_SECRET=1\n');
 * settle(() => operations.idle());
 * ```
 *
 * @param {import('node:test').TestContext} t
 * @param {string} name The fixture directory
 */
export const copy = (t, name) => {
	const parent = realpathSync(mkdtempSync(join(tmpdir(), 'beyond production ')));
	const settlers = [];
	t.after(async () => {
		for (const settler of settlers) await settler();
		rmSync(parent, { recursive: true, force: true });
	});
	const root = join(parent, 'workspace');
	cpSync(join(FIXTURES, name), root, { recursive: true });
	const write = (path, content) => {
		mkdirSync(dirname(join(root, path)), { recursive: true });
		writeFileSync(join(root, path), content);
	};
	return { root, parent, write, settle: settler => settlers.push(settler) };
};

/**
 * Waits until a condition holds, failing past a bound instead of hanging
 *
 * @param {() => Promise<boolean> | boolean} condition
 * @param {number} [bound]
 */
export const until = async (condition, bound = 30000) => {
	const started = Date.now();
	while (!(await condition())) {
		if (Date.now() - started > bound) throw new Error(`The condition did not hold within ${bound} ms`);
		await new Promise(resolve => setTimeout(resolve, 20));
	}
};
