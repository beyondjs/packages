import { realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

/**
 * Locations as a workspace identifies them. The identity of a directory is its real path, however it is
 * reached, and a member is named by its path relative to the root of the workspace, in POSIX form.
 */
export class Paths {
	/**
	 * The real path of an existing file or directory, symbolic links resolved
	 *
	 * @param {string} path
	 * @returns {string | undefined} Undefined when nothing exists at the path
	 */
	static real(path) {
		try {
			return realpathSync(resolve(path));
		} catch {
			return void 0;
		}
	}

	/**
	 * The canonical form of any path, existing or not: the real path of its deepest existing ancestor
	 * followed by the rest of it. A file that is about to be created has the identity it will have.
	 *
	 * @param {string} path
	 * @returns {string}
	 */
	static canonical(path) {
		const absolute = resolve(path);
		const rest = [];
		for (let current = absolute; ; current = dirname(current)) {
			const real = Paths.real(current);
			if (real !== undefined) return join(real, ...rest.reverse());
			if (dirname(current) === current) return absolute;
			rest.push(basename(current));
		}
	}

	/**
	 * Whether a path is a directory or something inside it. Both are compared as given: pass canonical
	 * paths to compare identities.
	 *
	 * @param {string} directory
	 * @param {string} path
	 */
	static contains(directory, path) {
		const relation = relative(directory, path);
		return relation === '' || (relation !== '..' && !relation.startsWith(`..${sep}`) && !isAbsolute(relation));
	}

	/**
	 * The POSIX path of a location relative to a root, `.` for the root itself. A location outside the root
	 * starts with `..`; it is never absolute unless the two are on different drives.
	 *
	 * @param {string} root
	 * @param {string} path
	 */
	static id(root, path) {
		return relative(root, path).split(sep).join('/') || '.';
	}
}
