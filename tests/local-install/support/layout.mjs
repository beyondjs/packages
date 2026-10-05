/**
 * The disk of a developer, recreated for one test file: copies of the acceptance fixtures in a unique temporary
 * directory (whose name holds a space, because paths with spaces must work), side by side as they would be on a
 * real machine, plus the directories an installation is given for its source store and its metadata cache.
 *
 * The checked-in fixtures are never written: every edit a test makes applies to the copy.
 */
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'acceptance');

export class Layout {
	/**
	 * Where the checked-in acceptance fixtures are
	 */
	static FIXTURES = FIXTURES;

	#directory;

	/**
	 * The canonical temporary directory of this layout
	 */
	get directory() {
		return this.#directory;
	}

	/**
	 * @param {string} label Names the directory, to tell the layouts of one run apart
	 */
	constructor(label) {
		this.#directory = realpathSync(mkdtempSync(join(tmpdir(), `beyond local-install ${label}-`)));
	}

	/**
	 * An absolute path inside the layout
	 */
	path(...segments) {
		return join(this.#directory, ...segments);
	}

	/**
	 * Copies a fixture group (`workspace`, `repositories`, `second`, `forms`, or a path inside one) into the layout
	 *
	 * @returns {string} The canonical directory of the copy
	 */
	copy(group, target = group) {
		const destination = this.path(target);
		cpSync(join(FIXTURES, group), destination, { recursive: true });
		return realpathSync(destination);
	}

	/**
	 * A short edit of a JSON document of the copy, such as a dependency added to a member's manifest
	 *
	 * @param {string} file Path relative to the layout
	 * @param {(data: object) => void} change
	 */
	edit(file, change) {
		const path = this.path(file);
		const data = JSON.parse(readFileSync(path, 'utf8'));
		change(data);
		writeFileSync(path, `${JSON.stringify(data, null, '\t')}\n`);
	}

	/**
	 * Puts a document of the copy back as the fixture holds it
	 *
	 * @param {string} file Path relative to the layout, the same relative to the fixtures
	 */
	restore(file) {
		writeFileSync(this.path(file), readFileSync(join(FIXTURES, file)));
	}

	/**
	 * Removes the layout and everything below it
	 */
	remove() {
		rmSync(this.#directory, { recursive: true, force: true });
	}
}

/**
 * What a directory holds, file by file with the digest of each, and directory by directory: two snapshots are
 * equal when nothing was written, created or removed below it.
 */
export class Snapshot {
	#entries = new Map();

	/**
	 * The relative paths and their digests (`dir` for a directory), sorted
	 */
	get entries() {
		return [...this.#entries].sort(([a], [b]) => (a < b ? -1 : 1));
	}

	/**
	 * Every relative path whose last segment is `name`
	 */
	named(name) {
		return this.entries.map(([path]) => path).filter(path => path.split('/').at(-1) === name);
	}

	/**
	 * @param {string} directory An absolute directory; nothing is read when it does not exist
	 */
	constructor(directory) {
		if (existsSync(directory)) this.#walk(directory, directory);
	}

	#walk(root, directory) {
		for (const entry of readdirSync(directory)) {
			const path = join(directory, entry);
			const key = relative(root, path).split(sep).join('/');
			if (statSync(path).isDirectory()) {
				this.#entries.set(key, 'dir');
				this.#walk(root, path);
				continue;
			}
			this.#entries.set(key, createHash('sha256').update(readFileSync(path)).digest('hex'));
		}
	}
}
