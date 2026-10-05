import type { IDiagnostic } from '@beyond-js/packages/types';
import { isAbsolute, resolve, relative, dirname, basename, sep, posix } from 'path';

/**
 * A member of a workspace, as the caller of a Workspace declares it
 */
export /*bundle*/ interface IWorkspaceMember {
	/**
	 * The id of the member: the POSIX path of its directory relative to the workspace root, as the workspace
	 * declares it (`.`, `app`, `../message-v2`). The workspace holds the package of the member under it.
	 */
	id: string;

	/**
	 * The absolute directory of the member, which may be outside the workspace root
	 */
	path: string;
}

/**
 * Where one package of a workspace is
 */
export interface ILocation {
	/**
	 * The absolute directory of the package
	 */
	path: string;

	/**
	 * Whether the toolchain supplies the package, which is then never watched
	 */
	supplied: boolean;
}

/**
 * What the packages of a workspace are declared with
 */
export interface ILocationsInput {
	/**
	 * The members the caller gives, which replace every other declaration of the packages of the workspace
	 */
	members?: IWorkspaceMember[];

	/**
	 * The package paths, relative to the workspace, that the caller gives or that its `beyond.json` declares
	 */
	packages?: unknown;

	/**
	 * The absolute directories of the packages the toolchain supplies
	 */
	supplied?: string[];
}

/**
 * Where the packages of a workspace are: each one under the key the workspace holds it by, at its absolute
 * directory.
 *
 * The packages of the workspace come from one declaration: the members the caller gives (keyed by their id,
 * at their absolute directories, inside the workspace root or not), or the package paths relative to the
 * workspace, which can neither leave it nor be absolute (keyed by their normalized relative path). The
 * packages the toolchain supplies come after them, keyed by their absolute directory. One directory is one
 * package: a directory reached twice is kept under its first key.
 */
export class Locations {
	#root: string;

	#entries: Map<string, ILocation> = new Map();

	/**
	 * The packages of the workspace by key, in declaration order, the supplied ones last
	 */
	get entries(): Map<string, ILocation> {
		return this.#entries;
	}

	#errors: IDiagnostic[] = [];
	get errors(): IDiagnostic[] {
		return this.#errors;
	}

	#warnings: IDiagnostic[] = [];
	get warnings(): IDiagnostic[] {
		return this.#warnings;
	}

	/**
	 * @param root The absolute directory of the workspace
	 */
	constructor(root: string, input: ILocationsInput) {
		this.#root = root;

		if (input.members) this.#members(input.members);
		else this.#packages(input.packages);
		if (this.#errors.length) return;

		// The packages the toolchain supplies come after the ones of the workspace, which take precedence
		(input.supplied ?? []).forEach(path => {
			if (typeof path !== 'string' || !isAbsolute(path)) return;
			this.#add(path, { path, supplied: true });
		});
	}

	/**
	 * Adds a package unless its directory is already one, which is reported unless it is a supplied package
	 * that the workspace already contains
	 */
	#add(key: string, location: ILocation): void {
		const directory = resolve(location.path);
		const previous = [...this.#entries].find(([, one]) => resolve(one.path) === directory);
		if (previous) {
			if (location.supplied) return;
			const message = `"${key}" is the directory of the package "${previous[0]}" again, which is one package`;
			this.#warnings.push({ code: 'INVALID_PACKAGE_PATH', message });
			return;
		}
		if (this.#entries.has(key)) {
			this.#warnings.push({ code: 'INVALID_PACKAGE_PATH', message: `The package "${key}" is declared more than once` });
			return;
		}
		this.#entries.set(key, location);
	}

	#members(members: IWorkspaceMember[]): void {
		if (!Array.isArray(members)) {
			this.#errors.push({ code: 'INVALID_MEMBERS', message: 'The members of a workspace must be an array' });
			return;
		}

		members.forEach(member => {
			const { id, path } = member ?? <IWorkspaceMember>{};
			if (!id || typeof id !== 'string' || !path || typeof path !== 'string' || !isAbsolute(path)) {
				const message = `Each member must have a non-empty id and an absolute path. Found: ${JSON.stringify(member)}`;
				this.#warnings.push({ code: 'INVALID_PACKAGE_PATH', message });
				return;
			}
			this.#add(id, { path, supplied: false });
		});
	}

	#packages(packages: unknown): void {
		// An empty value (absent, null, an empty string) declares the default, the package of the workspace root
		if (packages && !Array.isArray(packages)) {
			const code = 'INVALID_PACKAGES_PROPERTY';
			const message = '"packages" must be an array of strings';
			this.#errors.push({ code, message });
			return;
		}

		const paths = <unknown[]>(packages || ['.']);
		paths.forEach(path => {
			const fail = (message: string) => this.#warnings.push({ code: 'INVALID_PACKAGE_PATH', message });
			if (!path || typeof path !== 'string') return fail(`Each package path must be a non-empty string. Found: ${path}`);
			if (path.startsWith('..')) return fail(`Package paths cannot point to parent directories. Found: ${path}`);
			if (isAbsolute(path)) return fail(`Package paths cannot be absolute. Found: ${path}`);

			// The key is the path relative to the workspace, in POSIX form, naming the directory of the package
			let normalized = relative(this.#root, resolve(this.#root, path)).split(sep).join(posix.sep);
			basename(normalized) === 'package.json' && (normalized = dirname(normalized));
			normalized = normalized || '.';

			this.#add(normalized, { path: resolve(this.#root, normalized), supplied: false });
		});
	}
}
