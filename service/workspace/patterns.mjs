import { existsSync, globSync } from 'node:fs';
import { matchesGlob, posix, resolve, sep } from 'node:path';

/**
 * A list of workspace patterns, read with the semantics of npm (`@npmcli/map-workspaces`):
 *
 * - A leading `./` or `/` is removed: patterns are relative to the root, and `..` segments leave it.
 * - A pattern with an odd number of leading `!` is a negation (`!!a` is `a`). It removes the matches of
 *   every pattern, except that a later pattern it matches withdraws it (`['a/*', '!a/b', 'a/b']` keeps
 *   `a/b`), and a pattern it matches is dropped altogether.
 * - Nothing inside a `node_modules` directory matches, and a wildcard does not match a name that starts
 *   with a dot.
 * - `.` names the root itself. A wildcard does not select the root as `.` (`**` alone does not make the
 *   root a member), but a pattern that leaves the root and comes back into it, such as `../*`, matches it by
 *   its name, and then the root is a member, as it is for npm.
 *
 * A match is a path relative to the root in POSIX form; the matches of each pattern are sorted by path.
 * Whether a match is a package is decided by whoever reads it, as npm silently skips a match that holds no
 * `package.json`. Patterns with wildcards are expanded by Node's `fs.globSync`, which does not descend into
 * a symbolic link that a `**` reaches; a pattern without wildcards names one path and is checked directly.
 */
export class Patterns {
	/**
	 * What an expansion never enters
	 */
	static EXCLUDED = Object.freeze(['**/node_modules', '**/node_modules/**']);

	#root;
	#positive = [];
	#negated = [];

	/**
	 * @param {string} root The canonical directory the patterns are relative to
	 * @param {unknown[]} list The entries in declaration order. An entry that is not a non-empty string is
	 * not a pattern and is skipped, and the index of each pattern in this list is kept.
	 */
	constructor(root, list) {
		this.#root = root;
		list.forEach((raw, index) => typeof raw === 'string' && raw && this.#add(raw, index));

		// As npm does, a pattern that a negation matches is not expanded at all
		const negated = this.#negated;
		const dropped = ({ pattern }) => negated.some(negation => matchesGlob(pattern, negation));
		this.#positive = this.#positive.filter(positive => !dropped(positive));
	}

	#add(raw, index) {
		const marks = /^!+/.exec(raw)?.[0].length ?? 0;
		const pattern = raw.slice(marks).replace(/\\/g, '/').replace(/^\.?\/+/, '');
		if (marks % 2) return void this.#negated.push(pattern);

		// A pattern withdraws the earlier negations that match it: in ['a/**', '!a/b/**', 'a/b/c'], the last
		// pattern restores everything that the negation before it removed
		this.#negated = this.#negated.filter(negation => !matchesGlob(pattern, negation));
		this.#positive.push({ index, raw, pattern });
	}

	/**
	 * The matches of every pattern that is not a negation, in declaration order
	 *
	 * @returns {{index: number, pattern: string, paths: string[], error?: string}[]} `index` is the position
	 * of the pattern in the list, `pattern` as it was declared, and `error` why it could not be expanded
	 */
	expand() {
		return this.#positive.map(({ index, raw, pattern }) => {
			try {
				return { index, pattern: raw, paths: this.#match(pattern) };
			} catch (error) {
				return { index, pattern: raw, paths: [], error: error.message };
			}
		});
	}

	#match(pattern) {
		const magic = /[*?[\]{}()]/.test(pattern);
		const found = magic
			? globSync(pattern, { cwd: this.#root, exclude: Patterns.EXCLUDED }).filter(path => path !== '.')
			: [pattern || '.'].filter(path => existsSync(resolve(this.#root, path)));

		const paths = new Set();
		for (const match of found) {
			const path = posix.normalize(match.split(sep).join('/')).replace(/(.)\/+$/, '$1');

			// A wildcard does not select the root as `.`; one that reaches it by its name (`../*`) does
			if (magic && path === '.') continue;
			if (path.split('/').includes('node_modules')) continue;
			if (this.#excluded(path)) continue;
			paths.add(path);
		}
		return [...paths].sort((a, b) => a.localeCompare(b, 'en'));
	}

	/**
	 * Whether a negation removes a path. Like npm's glob, a negation `a/**` removes the directory `a` as well
	 * as what is inside it.
	 */
	#excluded(path) {
		return this.#negated.some(negation => matchesGlob(path, negation) || matchesGlob(`${path}/`, negation));
	}
}
