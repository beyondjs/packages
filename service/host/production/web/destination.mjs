import { lstat, mkdir, readFile, readdir, rename } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Paths } from '../../../workspace/paths.mjs';
import { Rules } from '../../exports/rules.mjs';
import { ProductionError } from '../error.mjs';

/**
 * Where a web export is written: a directory inside the workspace root, named relative to it (`dist/web`).
 *
 * It is refused (`EXPORT_DESTINATION_INVALID`) when it is absolute, has an empty, `.` or `..` segment, goes through
 * `.beyond`, `node_modules` or `.git`, is the root, is or contains a member's directory, lies inside a member other than
 * the root package, or reaches anything through a symbolic link. A destination that holds files is written only in
 * place of an earlier export of the same application and target, named by `replace` (its identifier); one that holds
 * anything else, or an earlier export that `replace` does not name, is `EXPORT_DESTINATION_CONFLICT`, whose details
 * name the export that can be replaced.
 *
 * The export is written in its staging directory ([Staging](./staging.mjs)) and moved into place with renames once
 * complete: an interrupted export leaves the earlier one as it was, or puts it back when the service starts again.
 *
 * ```js
 * const destination = new Destination(root, members).resolve('dist/web');
 * await destination.check({ application, target, replace });
 * await destination.commit(staging);   // a Staging
 * ```
 */
export class Destination {
	static MANIFEST = 'beyond-export.json';

	#root;
	#members;
	#relative;
	#directory;

	/**
	 * @param {string} root The canonical root of the workspace
	 * @param {string[]} members The canonical directories of the members of the workspace
	 */
	constructor(root, members) {
		this.#root = root;
		this.#members = members;
	}

	/**
	 * The destination relative to the root, in POSIX form
	 */
	get relative() {
		return this.#relative;
	}

	get directory() {
		return this.#directory;
	}

	static #invalid(message) {
		return new ProductionError('EXPORT_DESTINATION_INVALID', message);
	}

	/**
	 * @param {unknown} path The destination as the request names it
	 * @returns {Destination}
	 * @throws {ProductionError} `EXPORT_DESTINATION_INVALID`
	 */
	resolve(path) {
		if (typeof path !== 'string' || !path || path.length > 512) throw Destination.#invalid('"destination" is a directory inside the workspace, relative to its root');
		const segments = path.replace(/\/+$/, '').split('/');
		const malformed = path.startsWith('/') || path.includes('\\') || path.includes('\0') || segments.some(segment => !segment || segment === '.' || segment === '..');
		if (malformed) throw Destination.#invalid(`"${path}" is not a relative path without empty, "." or ".." segments`);
		if (Rules.internal(segments)) throw Destination.#invalid(`"${path}" goes through .beyond, node_modules or .git, which hold no export`);

		const directory = join(this.#root, ...segments);
		for (const member of this.#members) {
			if (Paths.contains(directory, member)) throw Destination.#invalid(`"${path}" is or contains the directory of a member of the workspace (${Paths.id(this.#root, member)})`);
			if (member !== this.#root && Paths.contains(member, directory)) throw Destination.#invalid(`"${path}" is inside the member "${Paths.id(this.#root, member)}", whose sources it would mix with`);
		}
		this.#relative = segments.join('/');
		this.#directory = directory;
		return this;
	}

	/**
	 * Refuses a destination whose existing path goes through a symbolic link or is not a directory
	 */
	async #walk() {
		const segments = this.#relative.split('/');
		for (let index = 1; index <= segments.length; index++) {
			const path = join(this.#root, ...segments.slice(0, index));
			const found = await lstat(path).catch(() => void 0);
			if (!found) return false;
			if (found.isSymbolicLink()) throw Destination.#invalid(`"${segments.slice(0, index).join('/')}" is a symbolic link`);
			if (!found.isDirectory()) throw Destination.#invalid(`"${segments.slice(0, index).join('/')}" is not a directory`);
		}
		return true;
	}

	/**
	 * The manifest of the export the destination holds, when it holds one
	 */
	async #previous() {
		try {
			const manifest = JSON.parse(await readFile(join(this.#directory, Destination.MANIFEST), 'utf8'));
			return manifest?.protocol === 'beyond-web-export/1' ? manifest : void 0;
		} catch {
			return;
		}
	}

	/**
	 * @param {{application: string, target: string, replace?: unknown}} request
	 * @returns {Promise<{state: 'absent' | 'empty' | 'replace', previous?: string}>}
	 * @throws {ProductionError} `EXPORT_DESTINATION_INVALID`, `EXPORT_DESTINATION_CONFLICT`
	 */
	async check({ application, target, replace }) {
		if (!(await this.#walk())) return { state: 'absent' };
		const entries = await readdir(this.#directory);
		if (!entries.length) return { state: 'empty' };

		const previous = await this.#previous();
		const same = previous && previous.application === application && previous.target === target;
		if (same && replace === previous.id) return { state: 'replace', previous: previous.id };
		const conflict = same
			? `"${this.#relative}" holds the export ${previous.id} of ${application}/${target}: name it in "replace" to replace it`
			: `"${this.#relative}" holds files that are not an export of ${application}/${target}: choose another destination, or empty it yourself`;
		throw new ProductionError('EXPORT_DESTINATION_CONFLICT', conflict, same ? { replace: previous.id } : { files: entries.length });
	}

	/**
	 * Puts a complete export in place: the earlier export moves aside, the new one takes its place, and the earlier one
	 * is removed; when the move fails, the earlier one is put back. The moves are journaled, so a service that stops
	 * between them puts things right when it starts again (`Staging.recover`).
	 *
	 * @param {import('./staging.mjs').Staging} staging
	 */
	async commit(staging) {
		await mkdir(dirname(this.#directory), { recursive: true });
		await staging.journal(this.#relative);
		const present = await lstat(this.#directory).catch(() => void 0);
		present && (await rename(this.#directory, staging.aside));
		try {
			await rename(staging.path, this.#directory);
		} catch (error) {
			present && (await rename(staging.aside, this.#directory).catch(() => void 0));
			throw error;
		}
	}
}
