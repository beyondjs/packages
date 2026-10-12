import { stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * The state directory of a workspace (`.beyond`) is ignored by Git through its own ignore file, which production work
 * writes when it is missing, before it keeps anything there (archives, export records), as the other features do
 *
 * ```js
 * await Ignored.ensure(root);
 * ```
 */
export class Ignored {
	/**
	 * @param {string} root The canonical root of the workspace
	 */
	static async ensure(root) {
		const file = join(root, '.beyond', '.gitignore');
		await stat(file).catch(() => writeFile(file, '*\n'));
	}
}
