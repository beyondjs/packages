import { readdirSync, statSync } from 'node:fs';
import { isAbsolute, join, relative, sep } from 'node:path';

const SKIPPED = new Set(['node_modules', '.git', '.beyond', '.artifacts']);
const NAMES = new Set(['beyond.json', 'package.json', 'module.json']);

/**
 * The declaration files of a workspace, and whether they changed since they were last looked at.
 *
 * Packages watches the sources of its processors, not the manifests that declare packages and modules, so a
 * workspace object keeps the declarations it read when it was created. The service compares the manifests
 * when it is asked to resolve or describe the workspace, and reloads the workspace when they differ; nothing
 * is watched, so nothing can be missed. Only names, sizes, modification times and inodes are read: which
 * packages and modules the manifests declare is decided by Packages.
 *
 * What is compared:
 *
 * - every manifest below the root, as before;
 * - the members of the declaration, read again each time, so that a member that a pattern now matches or no
 *   longer matches is a change, wherever its directory is;
 * - every manifest below a member directory the walk of the root does not reach: one outside the root, in its
 *   original repository, or reached through a symbolic link;
 * - the files of the root that describe its installation, which its creator names: the lock (`Execution.LOCK`) and
 *   the execution projection (`Execution.PATH`), whose change can make the installed graph ready, stale or missing.
 */
export class Manifests {
	#root;
	#declaration;
	#files;
	#signature;

	/**
	 * @param {string} root The canonical workspace directory
	 * @param {() => {kind?: string, members: {id: string, path: string}[]}} [declaration] Reads the declaration of
	 * the workspace as it is now
	 * @param {{files?: string[]}} [options] The files of the root that describe its installation, relative to it,
	 * which the walk skips or does not name (`.beyond` is skipped)
	 */
	constructor(root, declaration = () => ({ members: [] }), { files = [] } = {}) {
		this.#root = root;
		this.#declaration = declaration;
		this.#files = files;
		this.#signature = this.#read();
	}

	#read() {
		const { kind, members } = this.#members();
		const found = new Set([`declaration:${kind}`]);
		members.forEach(({ id, path }) => found.add(`member:${id}=${path}`));

		this.#walk(this.#root, found);
		members.filter(({ path }) => !this.#reached(path)).forEach(({ path }) => this.#walk(path, found));
		this.#files.forEach(file => found.add(Manifests.#stamp(join(this.#root, ...file.split('/')))));
		return [...found].sort().join('\n');
	}

	/**
	 * The members the declaration names now. A declaration that cannot be read is a state of its own, compared
	 * by its message, so that reading it again once it is corrected is a change.
	 */
	#members() {
		try {
			const { kind, members } = this.#declaration();
			return { kind, members: members.filter(({ path }) => typeof path === 'string') };
		} catch (error) {
			return { kind: `unreadable ${error?.message}`, members: [] };
		}
	}

	/**
	 * Whether the walk of the root reaches a directory: inside it, through no directory it skips. The walk does
	 * not follow symbolic links, and a member's directory is canonical, so a member reached through a link is
	 * outside the root or under another real directory of it.
	 */
	#reached(path) {
		const inside = relative(this.#root, path);
		if (inside === '') return true;
		if (inside.startsWith('..') || isAbsolute(inside)) return false;
		return inside.split(sep).every(name => !SKIPPED.has(name) && !name.startsWith('.'));
	}

	#walk(directory, found) {
		let entries;
		try {
			entries = readdirSync(directory, { withFileTypes: true });
		} catch {
			return;
		}

		for (const entry of entries) {
			if (entry.isDirectory()) {
				!SKIPPED.has(entry.name) && !entry.name.startsWith('.') && this.#walk(join(directory, entry.name), found);
			} else if (NAMES.has(entry.name)) {
				found.add(Manifests.#stamp(join(directory, entry.name)));
			}
		}
	}

	/**
	 * What says that a file changed: when it was written, its size and its inode. A file replaced by renaming
	 * another one over it, as the lock and the projection are written, has a new inode even when its size and its
	 * time are the same, which a filesystem with timestamps of one or two seconds allows.
	 */
	static #stamp(file) {
		const { mtimeMs, size, ino } = statSync(file, { throwIfNoEntry: false }) ?? {};
		return `${file}:${mtimeMs}:${size}:${ino}`;
	}

	/**
	 * Whether a manifest was added, removed or modified since the last call. The new state becomes the
	 * reference, so one change is reported once.
	 */
	get changed() {
		const current = this.#read();
		if (current === this.#signature) return false;

		this.#signature = current;
		return true;
	}

	/**
	 * Takes the manifests as they are now as the reference, when the workspace is reloaded for another reason
	 */
	update() {
		this.#signature = this.#read();
	}
}
