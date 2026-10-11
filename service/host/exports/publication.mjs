import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { join } from 'node:path';
import { Ignore } from './ignore.mjs';

/**
 * Which files of a package its registry publication would hold, which is what its archive holds, so that the bytes
 * of a capture and a later publication of the same sources come from the same file set:
 *
 * - With `files` in its manifest: the files those patterns name (each anchored at the package root, a directory naming
 *   everything inside it, a `!` pattern taking files back out), with `package.json`, `README*`, `LICENSE*` and
 *   `LICENCE*` at the root always.
 * - Without it: every file that the ignore files do not ignore, with Git's semantics; each directory's `.npmignore`, or
 *   its `.gitignore` when it has none, applies to everything below it, and an ignored directory is not entered.
 * - Never, in either case, what npm never publishes (`DEFAULTS`): the ignore files themselves, version-control
 *   directories, `npm-debug.log`, editor swap files, `.DS_Store`, `*.orig`, and the lockfiles of npm, Yarn and pnpm at
 *   the root.
 *
 * What `Rules` always leaves out (dependencies, internals, secrets) is decided before, by the archive. npm's other
 * additions (the `main` and `bin` files of a manifest with `files`, and the `.npmignore` files inside the directories
 * `files` names) are not reproduced.
 *
 * ```js
 * const publication = new Publication(directory, manifest);
 * const rules = await publication.rules('src');                 // the ignore file of a directory, if any
 * publication.includes('src/index.ts', false, [root, rules]);    // true or false
 * ```
 */
export class Publication {
	static DEFAULTS = new Ignore([
		'.npmignore', '.gitignore', '**/.git', '**/.svn', '**/.hg', '**/CVS', '/.lock-wscript', '/.wafpickle-*', '/build/config.gypi',
		'npm-debug.log', '.*.swp', '.DS_Store', '._*', '*.orig', '/package-lock.json', '/yarn.lock', '/pnpm-lock.yaml', '/archived-packages/'
	]);

	static ALWAYS = /^(package\.json|readme.*|licen[cs]e.*)$/i;

	/**
	 * The largest ignore file read, in bytes
	 */
	static LIMIT = 1048576;

	#directory;
	#files;

	/**
	 * @param {string} directory The canonical directory of the package
	 * @param {object} manifest Its `package.json`
	 */
	constructor(directory, manifest) {
		this.#directory = directory;
		const { files } = manifest ?? {};
		if (Array.isArray(files)) {
			const anchored = files.filter(entry => typeof entry === 'string' && entry.trim()).map(entry => {
				const negated = entry.startsWith('!');
				const pattern = (negated ? entry.slice(1) : entry).replace(/^\.\//, '');
				const rooted = pattern.startsWith('/') || pattern.startsWith('**') ? pattern : `/${pattern}`;
				return `${negated ? '!' : ''}${rooted}`;
			});
			this.#files = new Ignore(anchored);
		}
	}

	/**
	 * `files` when the manifest names the files it publishes, `ignore` when its ignore files decide
	 */
	get mode() {
		return this.#files ? 'files' : 'ignore';
	}

	/**
	 * The rules of a directory's ignore file: its `.npmignore`, or its `.gitignore` when it has none, read without
	 * following a link; undefined in `files` mode, or for a directory without one
	 *
	 * @param {string} relative The directory, relative to the package root ('' for the root)
	 * @returns {Promise<Ignore | undefined>}
	 */
	async rules(relative) {
		if (this.#files) return;
		for (const name of ['.npmignore', '.gitignore']) {
			const text = await Publication.#read(join(this.#directory, relative, name));
			if (text !== undefined) return new Ignore(text, relative);
		}
	}

	static async #read(file) {
		let handle;
		try {
			handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
			const stat = await handle.stat();
			if (!stat.isFile() || stat.size > Publication.LIMIT) return;
			return await handle.readFile('utf8');
		} catch {
			return;
		} finally {
			await handle?.close();
		}
	}

	/**
	 * Whether the publication holds an entry, once `Rules` kept it
	 *
	 * @param {string} path Relative to the package root, with `/`
	 * @param {boolean} directory
	 * @param {Ignore[]} rules The ignore rules of its ancestors, from the root down (`ignore` mode)
	 */
	includes(path, directory, rules = []) {
		if (!directory && !path.includes('/') && Publication.ALWAYS.test(path)) return true;
		if (Publication.DEFAULTS.test(path, directory)) return false;

		if (this.#files) {
			// Every directory is entered: a pattern may name files deep inside one it does not name
			if (directory) return true;
			const segments = path.split('/');
			let included = false;
			for (let index = 1; index <= segments.length; index++) {
				const decided = this.#files.test(segments.slice(0, index).join('/'), index < segments.length);
				if (decided !== undefined) included = decided;
			}
			return included;
		}

		let ignored = false;
		for (const rule of rules) {
			const decided = rule.test(path, directory);
			if (decided !== undefined) ignored = decided;
		}
		return !ignored;
	}
}
