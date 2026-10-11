import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { Declaration } from '../../workspace/declaration.mjs';
import { Paths } from '../../workspace/paths.mjs';
import { ExportError } from './error.mjs';
import { Rules } from './rules.mjs';

/**
 * The packages an export may freeze, named by their directory relative to the root of the workspace: `.`, the root
 * package (a root that holds a `package.json`), or the directory of a member the workspace declares inside its root.
 * Anything else is `EXPORT_PACKAGE_INVALID`: a path with an empty, `.` or `..` segment, an absolute one, a directory
 * that is not a member, a member outside the root (it belongs to another repository), a directory reached through a
 * symbolic link, and a package without a manifest that names it and its version. The declaration is read when the
 * export is asked for, so a member declared since the service started is there.
 *
 * ```js
 * const roots = new Roots(root).resolve(['.', 'packages/widgets']);
 * // [{path, directory, manifest, members}], members being the directories of other packages inside it
 * ```
 */
export class Roots {
	/**
	 * The largest manifest of a package, in bytes, as a capture accepts it
	 */
	static MANIFEST = 262144;

	/**
	 * The most packages of one export, as one capture holds them
	 */
	static LIMIT = 50;

	#root;

	/**
	 * @param {string} root The canonical root of the workspace
	 */
	constructor(root) {
		this.#root = root;
	}

	static #invalid(message) {
		return new ExportError('EXPORT_PACKAGE_INVALID', message);
	}

	/**
	 * The segments of a path as an export names a package, or an error
	 */
	static #segments(path) {
		if (typeof path !== 'string' || !path || path.length > 512) throw Roots.#invalid('A package is named by its directory relative to the root, or "."');
		if (path === '.') return [];
		const segments = path.split('/');
		const malformed = path.includes('\\') || path.includes('\0') || path.startsWith('/') || segments.some(segment => !segment || segment === '.' || segment === '..');
		if (malformed) throw Roots.#invalid(`"${path}" is not a relative path without empty, "." or ".." segments`);
		if (Rules.internal(segments)) throw Roots.#invalid(`"${path}" is inside node_modules, .git or .beyond, where no package of the workspace lives`);
		return segments;
	}

	/**
	 * The directories of the packages of the workspace inside the root, by their path relative to it
	 */
	#candidates() {
		const declaration = Declaration.read(this.#root);
		const candidates = new Map();
		for (const { path } of declaration.members) {
			if (path !== this.#root && Paths.contains(this.#root, path)) candidates.set(Paths.id(this.#root, path), path);
		}
		candidates.set('.', this.#root);
		return candidates;
	}

	/**
	 * The manifest of a package, which must name it and its version
	 */
	static #manifest(directory, path) {
		const file = join(directory, 'package.json');
		let manifest;
		try {
			const found = lstatSync(file);
			if (!found.isFile() || found.size > Roots.MANIFEST) throw new Error('not a file of at most 256 KiB');
			manifest = JSON.parse(readFileSync(file, 'utf8'));
		} catch {
			throw Roots.#invalid(`"${path}" holds no readable package.json of at most ${Roots.MANIFEST} bytes`);
		}
		if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest) || typeof manifest.name !== 'string' || typeof manifest.version !== 'string') {
			throw Roots.#invalid(`The package.json of "${path}" does not name the package and its version`);
		}
		return manifest;
	}

	/**
	 * @param {unknown} paths
	 * @returns {{path: string, directory: string, manifest: object, members: string[]}[]}
	 * @throws {ExportError} `EXPORT_PACKAGE_INVALID`
	 */
	resolve(paths) {
		if (!Array.isArray(paths) || !paths.length || paths.length > Roots.LIMIT) throw Roots.#invalid(`An export names from 1 to ${Roots.LIMIT} packages`);
		if (new Set(paths).size !== paths.length) throw Roots.#invalid('An export names each package once');

		const candidates = this.#candidates();
		const directories = [...candidates.values()];
		return paths.map(path => {
			const segments = Roots.#segments(path);
			const directory = candidates.get(path);
			if (!directory) throw Roots.#invalid(`"${path}" is not "." or the directory of a member the workspace declares inside its root`);

			let real;
			try {
				real = realpathSync(join(this.#root, ...segments));
			} catch {
				throw Roots.#invalid(`"${path}" does not exist`);
			}
			if (real !== directory) throw Roots.#invalid(`"${path}" is reached through a symbolic link`);

			const manifest = Roots.#manifest(directory, path);
			const members = directories.filter(other => other !== directory && Paths.contains(directory, other));
			return { path, directory, manifest, members };
		});
	}
}
