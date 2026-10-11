import { realpathSync } from 'fs';
import { dirname, join, sep } from 'path';
import { DevelopmentError } from './error';

const TEMPORARY = '.beyond-write-';

/**
 * The served root and the rules of what a contract path may name inside it.
 *
 * A path is relative, uses `/` and has no empty, `.` or `..` segment. Resolution follows symbolic links and
 * refuses a target outside the root, so neither a segment nor a link reaches another part of the host.
 */
export class Root {
	#path: string;
	get path() {
		return this.#path;
	}

	/**
	 * The directory of the root where this service keeps the state of the working copy, such as the
	 * development selection. It is not source: it is never listed, announced or reachable as a file.
	 */
	static STATE = '.beyond';

	/**
	 * Directory names that are never indexed, watched or announced
	 */
	static EXCLUDED = new Set(['.git', 'node_modules', Root.STATE]);

	constructor(path: string) {
		this.#path = realpathSync(path);
	}

	/**
	 * @returns Whether the path belongs to the tree clients see
	 */
	visible(path: string): boolean {
		const segments = path.split('/');
		if (segments.some(segment => Root.EXCLUDED.has(segment))) return false;
		return !segments[segments.length - 1].startsWith(TEMPORARY);
	}

	/**
	 * The name of the temporary file an atomic write of `file` goes through, in the same directory
	 */
	temporary(file: string): string {
		return join(dirname(file), `${TEMPORARY}${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	}

	/**
	 * A contract path, checked: relative, with `/`, without empty, `.` or `..` segments, and through no repository
	 * internals (`.git`) or state of the service (`.beyond`) at any depth, compared without regard to case because a
	 * filesystem may not regard it (a nested repository's `sub/.git/config` would otherwise be writable)
	 *
	 * @throws DevelopmentError `PATH_INVALID` (400) or `PATH_FORBIDDEN` (403)
	 */
	validate(path: unknown): string {
		const invalid = () => new DevelopmentError('PATH_INVALID', `Invalid path "${path}"`, 400);
		if (typeof path !== 'string' || !path.length || path.includes('\\') || path.includes('\0')) throw invalid();
		if (path.startsWith('/') || path.endsWith('/')) throw invalid();
		const segments = path.split('/');
		if (segments.some(segment => !segment || segment === '.' || segment === '..')) throw invalid();
		const lower = segments.map(segment => segment.toLowerCase());
		if (lower.includes('.git')) throw new DevelopmentError('PATH_FORBIDDEN', 'Repository internals are not served', 403);
		if (lower.includes(Root.STATE)) throw new DevelopmentError('PATH_FORBIDDEN', 'The state of the development service is not a source file', 403);
		return path;
	}

	/**
	 * @returns The absolute file a valid path names
	 * @throws PATH_FORBIDDEN when the deepest existing ancestor resolves outside the root
	 */
	resolve(path: string): string {
		const file = join(this.#path, ...this.validate(path).split('/'));

		let existing = file;
		for (;;) {
			try {
				const real = realpathSync(existing);
				if (real !== this.#path && !real.startsWith(this.#path + sep)) {
					throw new DevelopmentError('PATH_FORBIDDEN', `"${path}" resolves outside the served root`, 403);
				}
				return file;
			} catch (error) {
				if (error instanceof DevelopmentError) throw error;
				const parent = dirname(existing);
				if (parent === existing) throw new DevelopmentError('PATH_FORBIDDEN', `"${path}" cannot be resolved`, 403);
				existing = parent;
			}
		}
	}
}
