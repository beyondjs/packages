import { readdirSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { TestsError } from './error.mjs';

/**
 * The test files of a run, collected as `beyond test` collects them: `<name>.test.ts`, `.mts`, `.js` or `.mjs`, every
 * one under the workspace root when none is named, hidden directories and `node_modules` never walked, sorted by path.
 * A named file is a path relative to the root, which must be a test file inside it.
 *
 * ```js
 * const collection = new Collection(root, ['web/home/view.test.ts']);
 * collection.files;   // absolute paths
 * collection.names;   // relative to the root, with forward slashes
 * ```
 */
export class Collection {
	static PATTERN = /\.test\.(m?[jt]s)$/;
	static SKIPPED = new Set(['node_modules']);
	static LIMIT = 1000;

	#root;
	#files = [];

	/**
	 * @param {string} root The canonical root of the workspace
	 * @param {unknown} [named] The files a request names
	 * @throws {TestsError} `TESTS_FILES_INVALID`
	 */
	constructor(root, named) {
		this.#root = root;
		if (named === undefined) {
			const found = [];
			this.#walk(root, found);
			this.#files = found.sort();
			return;
		}
		if (!Array.isArray(named) || named.length > Collection.LIMIT) throw new TestsError('TESTS_FILES_INVALID', `"files" is a list of at most ${Collection.LIMIT} test files of the workspace`);
		this.#files = [...new Set(named.map(path => this.#file(path)))].sort();
	}

	#file(path) {
		const invalid = () => new TestsError('TESTS_FILES_INVALID', `"${path}" is not a test file of the workspace (a test file is named <name>.test.ts, .mts, .js or .mjs)`);
		if (typeof path !== 'string' || !path || path.includes('\0') || isAbsolute(path) || !Collection.PATTERN.test(path)) throw invalid();
		const file = resolve(this.#root, path);
		let real;
		try {
			real = realpathSync(file);
			if (!statSync(real).isFile()) throw invalid();
		} catch (error) {
			if (error instanceof TestsError) throw error;
			throw invalid();
		}
		const inside = relative(this.#root, real);
		if (!inside || inside.startsWith('..') || isAbsolute(inside)) throw invalid();
		return real;
	}

	#walk(directory, found) {
		for (const entry of readdirSync(directory, { withFileTypes: true })) {
			if (found.length >= Collection.LIMIT) return;
			const path = join(directory, entry.name);
			if (entry.isDirectory()) {
				if (!entry.name.startsWith('.') && !Collection.SKIPPED.has(entry.name)) this.#walk(path, found);
			} else if (entry.isFile() && Collection.PATTERN.test(entry.name)) {
				found.push(path);
			}
		}
	}

	get files() {
		return [...this.#files];
	}

	get names() {
		return this.#files.map(file => relative(this.#root, file).split(sep).join('/'));
	}
}
