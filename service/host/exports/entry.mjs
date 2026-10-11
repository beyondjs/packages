import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { ExportError } from './error.mjs';

/**
 * One file of a package as the archive reads it: opened without following a link (`O_NOFOLLOW`), and checked to be
 * the very entry the walk listed, by its device and inode, so that a file replaced by a link or by another file
 * between the walk and the read is never archived in its place.
 *
 * ```js
 * const walked = await lstat(file);
 * const bytes = await Entry.read(file, walked, 'src/index.ts');   // or ExportError EXPORT_CHANGED
 * ```
 */
export class Entry {
	static #FLAGS = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0);

	/**
	 * The error of an entry that is not the one that was walked
	 *
	 * @param {string} path
	 */
	static changed(path) {
		return new ExportError('EXPORT_CHANGED', `"${path}" changed while the package was exported: export it again`);
	}

	/**
	 * @param {string} absolute
	 * @param {{dev: number, ino: number}} walked What the walk found at that path
	 * @param {string} path The path relative to the package, for the error
	 * @returns {Promise<Buffer>}
	 * @throws {ExportError} `EXPORT_CHANGED`
	 */
	static async read(absolute, walked, path) {
		let handle;
		try {
			handle = await open(absolute, Entry.#FLAGS);
		} catch (error) {
			// A link put where the file was is refused by O_NOFOLLOW, and a file that is gone is a change too
			throw ['ELOOP', 'ENOENT', 'EMLINK'].includes(error.code) ? Entry.changed(path) : error;
		}
		try {
			const stat = await handle.stat();
			if (!stat.isFile() || stat.dev !== walked.dev || stat.ino !== walked.ino) throw Entry.changed(path);
			return await handle.readFile();
		} finally {
			await handle.close();
		}
	}
}
