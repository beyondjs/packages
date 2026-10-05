import type { IDiagnostic } from '@beyond-js/packages/types';
import * as semver from 'semver';

/**
 * What a `workspace:` specifier selects, as pnpm and yarn write it. The text after the prefix is:
 *
 * - empty, `*`, `^` or `~`: any member that provides the declared name;
 * - a semver version or range: the members of the declared name that satisfy it;
 * - anything else: the id of one member, the POSIX path of its directory relative to the workspace root. An id
 *   that would read as a range is written with a leading `./` (`workspace:./v1`), which is not part of the id.
 *
 * Only a workspace resolves it: the specifier names no registry, repository or archive.
 */
export /*bundle*/ class WorkspaceInfo {
	static PREFIX = 'workspace:';

	#range?: string;
	/**
	 * The range a member of the declared name is selected with, `*` for any version
	 */
	get range() {
		return this.#range;
	}

	#member?: string;
	/**
	 * The id of the member the specifier names
	 */
	get member() {
		return this.#member;
	}

	#error?: IDiagnostic;
	/**
	 * Why the specifier names neither a range nor a member: `INVALID_SPECIFIER` for an id that is not a relative POSIX
	 * path (absolute, or with backslashes)
	 */
	get error() {
		return this.#error;
	}

	/**
	 * @param value The text after the `workspace:` prefix
	 */
	constructor(value: string) {
		if (['', '*', '^', '~'].includes(value)) {
			this.#range = '*';
			return;
		}
		if (!value.startsWith('.') && semver.validRange(value)) {
			this.#range = value;
			return;
		}

		// An id is a relative POSIX path: never absolute, without backslashes
		if (value.startsWith('/') || value.includes('\\')) {
			const message = `"workspace:${value}" names no member: a member is named by the POSIX path of its directory relative to the workspace root`;
			this.#error = { code: 'INVALID_SPECIFIER', message };
			return;
		}
		this.#member = WorkspaceInfo.#normalize(value);
	}

	/**
	 * The canonical form of a relative path: no empty or `.` segments, `..` applied to the segment before it and
	 * kept at the start, `.` for the root itself
	 */
	static #normalize(path: string): string {
		const segments: string[] = [];
		for (const segment of path.split('/')) {
			if (!segment || segment === '.') continue;
			const previous = segments[segments.length - 1];
			if (segment === '..' && previous && previous !== '..') segments.pop();
			else segments.push(segment);
		}
		return segments.length ? segments.join('/') : '.';
	}

	/**
	 * Parses a specifier, returning `undefined` when it is not a `workspace:` specifier
	 */
	static parse(spec: string): WorkspaceInfo | undefined {
		if (typeof spec !== 'string' || !spec.startsWith(WorkspaceInfo.PREFIX)) return;
		return new WorkspaceInfo(spec.slice(WorkspaceInfo.PREFIX.length));
	}
}
