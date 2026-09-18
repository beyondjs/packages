import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, isAbsolute, basename } from 'node:path';

/**
 * A context that cannot be established, with a stable code for whoever presents it
 */
export class ContextError extends Error {
	constructor(code, message) {
		super(message);
		this.name = 'ContextError';
		this.code = code;
	}
}

/**
 * Which workspace a command or a client refers to, located from a directory.
 *
 * The rule is deterministic and never searches the machine:
 *
 * 1. An explicit root is that exact directory: a workspace when it holds a `beyond.json`, a standalone
 *    package when it only holds a `package.json`, an error otherwise.
 * 2. Otherwise the nearest ancestor with a `beyond.json` is the workspace, provided the nearest package that
 *    contains the directory is one of its declared packages. A package that merely sits below an unrelated
 *    workspace file is not silently adopted by it, and the workspace is not silently ignored either: the
 *    mismatch is an error that names both and says how to be explicit.
 * 3. Without a workspace file, the nearest package is a standalone context. Nothing is written into it.
 *
 * Paths are canonical (symbolic links resolved), so one workspace has one identity however it is reached.
 * Only which directory is the context is decided here; packages, modules and selectors are resolved by
 * Packages inside the service.
 */
export class Context {
	#root;

	/**
	 * The canonical directory of the workspace, or of the standalone package
	 */
	get root() {
		return this.#root;
	}

	#standalone;

	/**
	 * Whether the context is one package without a workspace file
	 */
	get standalone() {
		return this.#standalone;
	}

	#directory;

	/**
	 * The canonical directory the context was located from, which is where local selectors are resolved
	 */
	get directory() {
		return this.#directory;
	}

	/**
	 * @param {{directory?: string, workspace?: string}} [options] Where the command runs, and the explicit root
	 */
	constructor({ directory = process.cwd(), workspace } = {}) {
		this.#directory = Context.#canonical(directory, 'CONTEXT_DIRECTORY_INVALID');
		workspace !== undefined ? this.#explicit(workspace) : this.#discover();
	}

	static #canonical(path, code) {
		try {
			const canonical = realpathSync(resolve(path));
			if (!statSync(canonical).isDirectory()) throw new Error('not a directory');
			return canonical;
		} catch {
			throw new ContextError(code, `"${path}" is not an existing directory`);
		}
	}

	#explicit(workspace) {
		const root = Context.#canonical(workspace, 'CONTEXT_WORKSPACE_INVALID');
		const configured = existsSync(join(root, 'beyond.json'));
		if (!configured && !existsSync(join(root, 'package.json'))) {
			const message = `"${root}" is not a workspace: it has neither a beyond.json nor a package.json`;
			throw new ContextError('CONTEXT_WORKSPACE_INVALID', message);
		}

		this.#root = root;
		this.#standalone = !configured;
	}

	#discover() {
		let pkg;
		for (let current = this.#directory; ; current = dirname(current)) {
			// Installed dependencies are not projects under development
			const vendored = basename(dirname(current)) === 'node_modules' || basename(current) === 'node_modules';

			if (!vendored && !pkg && existsSync(join(current, 'package.json'))) pkg = current;
			if (!vendored && existsSync(join(current, 'beyond.json'))) return this.#workspace(current, pkg);
			if (dirname(current) === current) break;
		}

		if (!pkg) {
			const message =
				`No Beyond context found from "${this.#directory}": no ancestor has a beyond.json or a package.json. ` +
				`Run the command inside a package or a workspace, or name one with --workspace`;
			throw new ContextError('CONTEXT_NOT_FOUND', message);
		}

		this.#root = pkg;
		this.#standalone = true;
	}

	/**
	 * Accepts the nearest workspace file when the package the directory belongs to is one of its members
	 */
	#workspace(root, pkg) {
		const inside = pkg && !relative(root, pkg).startsWith('..') && !isAbsolute(relative(root, pkg));
		if (inside && !Context.#members(root).includes(pkg)) {
			const message =
				`Package "${pkg}" is below the workspace "${root}" but is not one of the packages of its beyond.json. ` +
				`Add it to that workspace, or run it on its own with --workspace "${pkg}"`;
			throw new ContextError('CONTEXT_NOT_MEMBER', message);
		}

		this.#root = root;
		this.#standalone = false;
	}

	/**
	 * The canonical directories of the packages a workspace file declares. An entry names a directory or its
	 * package.json, and a workspace that declares none is its own single package.
	 */
	static #members(root) {
		let config;
		try {
			config = JSON.parse(readFileSync(join(root, 'beyond.json'), 'utf8'));
		} catch (error) {
			throw new ContextError('CONTEXT_WORKSPACE_INVALID', `"${join(root, 'beyond.json')}" cannot be read: ${error.message}`);
		}

		const packages = config?.packages instanceof Array ? config.packages : ['.'];
		return packages
			.filter(entry => typeof entry === 'string' && entry)
			.map(entry => resolve(root, basename(entry) === 'package.json' ? dirname(entry) : entry))
			.filter(path => existsSync(path))
			.map(path => realpathSync(path));
	}
}
