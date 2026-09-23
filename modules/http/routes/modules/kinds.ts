import { promises as fs } from 'fs';
import { extname, join } from 'path';

/**
 * Which public modules of the workspace are style modules: a module whose `exports` target is a stylesheet
 * (`"./theme": "./theme.css"`), as the declarations of a package read it. A style module has a stylesheet and
 * no JavaScript, so neither a module request nor a resolution asks the delivery to compile its code.
 */
export class Kinds {
	static #STYLES = ['.css', '.scss', '.sass'];

	/**
	 * @param module A public module of the workspace: the directory of its package and its subpath
	 */
	static async style(module: { path?: string; subpath: string }): Promise<boolean> {
		if (!module.path) return false;
		try {
			const { exports } = JSON.parse(await fs.readFile(join(module.path, 'package.json'), 'utf8'));
			const target = typeof exports === 'string' && module.subpath === '.' ? exports : exports?.[module.subpath];
			return typeof target === 'string' && target.startsWith('./') && Kinds.#STYLES.includes(extname(target));
		} catch {
			return false;
		}
	}
}
