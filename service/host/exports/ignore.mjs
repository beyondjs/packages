/**
 * The patterns of one ignore file (`.npmignore`, `.gitignore`) or list, with Git's semantics, matched against paths
 * relative to the directory the patterns belong to (`base`), in POSIX form.
 *
 * - Blank lines and lines starting with `#` are nothing; `\#` and `\!` start a pattern with those characters, and
 *   trailing spaces are dropped unless escaped.
 * - `!` negates: a path a later negated pattern matches is not ignored. The last pattern that matches decides.
 * - A pattern ending with `/` matches directories only. A pattern with a `/` at its start or in its middle is
 *   anchored to the base; any other one matches a name at any depth below it.
 * - `*` matches anything but `/`, `?` one character but `/`, `[…]` a class (`[!…]` its complement), a leading `**/`
 *   any directories, a trailing `/**` everything inside, and `**` between two slashes zero or more directories.
 *
 * ```js
 * const ignore = new Ignore(['dist/', '*.log', '!keep.log'], 'packages/app');
 * ignore.test('packages/app/dist', true);    // true: ignored
 * ignore.test('packages/app/keep.log');      // false: matched by a negation
 * ignore.test('packages/app/src/a.ts');      // undefined: no pattern matched
 * ```
 */
export class Ignore {
	#base;
	#rules;

	/**
	 * @param {string[] | string} patterns The lines of an ignore file, or its text
	 * @param {string} [base] The directory they belong to, relative to the root of the walk ('' for the root)
	 */
	constructor(patterns, base = '') {
		const lines = typeof patterns === 'string' ? patterns.split(/\r?\n/) : patterns;
		this.#base = base;
		this.#rules = lines.map(line => Ignore.#compile(String(line))).filter(Boolean);
	}

	/**
	 * Whether any pattern was read
	 */
	get size() {
		return this.#rules.length;
	}

	/**
	 * A line compiled to a rule, or undefined for a line that holds no pattern
	 */
	static #compile(line) {
		let text = line.replace(/(?<!\\)\s+$/, '');
		if (!text || text.startsWith('#')) return;
		const negated = text.startsWith('!');
		if (negated) text = text.slice(1);
		if (text.startsWith('\\#') || text.startsWith('\\!')) text = text.slice(1);
		const directory = text.endsWith('/');
		if (directory) text = text.replace(/\/+$/, '');
		if (!text) return;

		const anchored = text.includes('/');
		const body = Ignore.#translate(text.replace(/^\//, ''));
		return { negated, directory, pattern: new RegExp(anchored ? `^${body}$` : `^(?:.*/)?${body}$`) };
	}

	/**
	 * The regular expression of a pattern's text
	 */
	static #translate(text) {
		let out = '';
		for (let index = 0; index < text.length; index++) {
			const character = text[index];
			if (text.startsWith('**/', index) && (index === 0 || text[index - 1] === '/')) {
				out += '(?:.*/)?';
				index += 2;
			} else if (text.startsWith('**', index) && index + 2 === text.length && text[index - 1] === '/') {
				out += '.*';
				index += 1;
			} else if (character === '*') {
				while (text[index + 1] === '*') index++;
				out += '[^/]*';
			} else if (character === '?') out += '[^/]';
			else if (character === '[') {
				const end = text.indexOf(']', index + 2);
				if (end === -1) {
					out += '\\[';
					continue;
				}
				const inner = text.slice(index + 1, end).replace(/^!/, '^').replace(/\\/g, '\\\\');
				out += `(?![/])[${inner}]`;
				index = end;
			} else if (character === '\\' && index + 1 < text.length) {
				out += Ignore.#escape(text[++index]);
			} else out += Ignore.#escape(character);
		}
		return out;
	}

	static #escape(character) {
		return character.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
	}

	/**
	 * What the patterns say of a path: `true` when the last pattern that matches it ignores it, `false` when it is a
	 * negation, and `undefined` when none matches or the path is not below the base
	 *
	 * @param {string} path Relative to the root of the walk, with `/`
	 * @param {boolean} [directory] Whether the path is a directory
	 * @returns {boolean | undefined}
	 */
	test(path, directory = false) {
		let relative = path;
		if (this.#base) {
			if (!path.startsWith(`${this.#base}/`)) return;
			relative = path.slice(this.#base.length + 1);
		}
		let decided;
		for (const rule of this.#rules) {
			if (rule.directory && !directory) continue;
			if (rule.pattern.test(relative)) decided = !rule.negated;
		}
		return decided;
	}
}
