import { realpathSync, statSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { Configuration } from './workspace/configuration.mjs';
import { Declaration } from './workspace/declaration.mjs';
import { Paths } from './workspace/paths.mjs';

/**
 * A context that cannot be established, with a stable code for whoever presents it
 */
export class ContextError extends Error {
	/**
	 * @param {string} code
	 * @param {string} message
	 * @param {{code: string, message: string}[]} [diagnostics] The findings behind the error, when there are
	 * several
	 */
	constructor(code, message, diagnostics) {
		super(message);
		this.name = 'ContextError';
		this.code = code;
		if (diagnostics) this.diagnostics = diagnostics;
	}
}

/**
 * Which workspace a command or a client refers to, located from a directory.
 *
 * A directory is a workspace root when it holds a `beyond.json`, or a `package.json` that declares
 * `workspaces` (npm) or `beyond.workspaces` (the Beyond extension). The rule is deterministic and never
 * searches the machine:
 *
 * 1. An explicit root is that exact directory: a workspace when it is a workspace root, a standalone
 *    package when it only holds a `package.json`, an error otherwise.
 * 2. Otherwise the nearest ancestor that is a workspace root is the workspace, provided the nearest package
 *    that contains the directory is one of its members, or the root itself. A package that merely sits below
 *    an unrelated workspace is not silently adopted by it, and the workspace is not silently ignored either:
 *    the mismatch is an error that names both and says how to be explicit.
 * 3. Without a workspace root, the nearest package is a standalone context. Nothing is written into it.
 *
 * The context is decided by the files that exist and never fails for what a manifest contains: a service has
 * to start for its files to be corrected through it. A `package.json` that cannot be read declares no
 * workspace, so the search goes on above it, and a broken manifest high in the tree, such as in a home
 * directory, breaks nothing below it; the declaration of the context reports it when it is its own
 * (`WORKSPACE_CONFIG_INVALID` for the root's, `MEMBER_MANIFEST_INVALID` for a member's). A package below a
 * root whose members cannot be read at all is the one exception: whether it belongs there cannot be decided.
 *
 * A member outside its workspace root (`../message-v2`, or a directory reached through a symbolic link) is
 * found from inside it only through its own nearest configuration: it reaches the workspace that declares
 * it with an explicit root. Paths are canonical (symbolic links resolved), so one workspace has one
 * identity however it is reached. Which directory is the context and what it declares are decided here;
 * packages, modules and selectors are resolved by Packages inside the service.
 */
export class Context {
	/**
	 * The diagnostics of a workspace that leave its members undecided
	 */
	static #UNDECIDED = Object.freeze(['WORKSPACE_CONFIG_INVALID', 'WORKSPACE_CONFIG_CONFLICT']);

	#root;

	/**
	 * The canonical directory of the workspace, or of the standalone package
	 */
	get root() {
		return this.#root;
	}

	#standalone;

	/**
	 * Whether the context is one package without a workspace configuration
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

	#declaration;

	/**
	 * What the root declares: its kind, members, diagnostics and inputs
	 *
	 * @returns {Declaration}
	 */
	get declaration() {
		return this.#declaration;
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
		const configuration = new Configuration(root);
		if (!configuration.configured && !configuration.manifest.exists) {
			const message = `"${root}" is not a workspace: it has neither a beyond.json nor a package.json`;
			throw new ContextError('CONTEXT_WORKSPACE_INVALID', message);
		}

		this.#establish(root);
	}

	#discover() {
		let pkg;
		for (let current = this.#directory; ; current = dirname(current)) {
			// Installed dependencies are not projects under development
			const vendored = basename(dirname(current)) === 'node_modules' || basename(current) === 'node_modules';

			if (!vendored) {
				// A manifest that cannot be read declares no workspace: `root` is then decided by a beyond.json alone
				const configuration = new Configuration(current);
				if (!pkg && configuration.manifest.exists) pkg = current;
				if (configuration.root) return this.#workspace(current, pkg);
			}
			if (dirname(current) === current) break;
		}

		if (!pkg) {
			const message =
				`No Beyond context found from "${this.#directory}": no ancestor has a beyond.json or a package.json. ` +
				`Run the command inside a package or a workspace, or name one with --workspace`;
			throw new ContextError('CONTEXT_NOT_FOUND', message);
		}

		this.#establish(pkg);
	}

	/**
	 * Accepts the nearest workspace root when the package the directory belongs to is one of its members,
	 * or the root itself
	 */
	#workspace(root, pkg) {
		const declaration = Declaration.read(root);
		const below = pkg && pkg !== root && Paths.contains(root, pkg);

		if (below && !declaration.member(pkg)) {
			const undecided = declaration.diagnostics.filter(({ code }) => Context.#UNDECIDED.includes(code));
			if (undecided.length) {
				const message =
					`Whether "${pkg}" is a member of the workspace "${root}" cannot be decided: ` +
					`${undecided[0].message}. ` +
					`Correct it, or name the workspace with --workspace`;
				throw new ContextError('CONTEXT_WORKSPACE_INVALID', message, undecided);
			}

			const declared =
				declaration.kind === 'beyond-json'
					? 'one of the packages of its beyond.json'
					: 'one of the members its package.json declares in "workspaces" or "beyond.workspaces"';
			const message =
				`Package "${pkg}" is below the workspace "${root}" but is not ${declared}. ` +
				`Add it to that workspace, or run it on its own with --workspace "${pkg}"`;
			throw new ContextError('CONTEXT_NOT_MEMBER', message);
		}

		this.#root = root;
		this.#standalone = false;
		this.#declaration = declaration;
	}

	/**
	 * A root named explicitly, or the nearest package without a workspace above it
	 */
	#establish(root) {
		this.#root = root;
		this.#declaration = Declaration.read(root);
		this.#standalone = this.#declaration.kind === 'standalone';
	}
}
