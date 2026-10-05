import { resolve } from 'node:path';
import { Configuration } from './configuration.mjs';
import { Diagnostics } from './diagnostics.mjs';
import { Entries } from './entries.mjs';
import { Inputs } from './inputs.mjs';
import { Members } from './members.mjs';
import { Paths } from './paths.mjs';

/**
 * What a workspace root declares: its kind, its members and the digests of the inputs its dependency graph
 * is built from. Read synchronously from the root's configuration files and the manifests of its members,
 * never from anywhere else.
 *
 * ```js
 * const declaration = Declaration.read(root);
 * declaration.kind;      // 'npm' | 'beyond-json' | 'standalone'
 * declaration.members;   // [{id, path, name, version, manifest, source}], in declaration order
 * declaration.valid;     // no error among declaration.diagnostics
 * ```
 *
 * The members of an `npm` root are the matches of its package.json `workspaces` (npm's semantics) followed
 * by the entries of `beyond.workspaces`, the Beyond extension that can name a second package of an existing
 * name, inside or outside the root. A `beyond-json` root reads the `packages` of its `beyond.json`. A
 * directory without either is a `standalone` package, its own single member `.`. A member is identified by
 * its canonical directory and named by its path relative to the root as declared or matched, in POSIX form
 * (`packages/widgets`, `../message-v2`, `.`), even when that path is a symbolic link to somewhere else.
 *
 * Problems of the content never throw: they are diagnostics (see `Entries` and `Members` for their codes),
 * and the members that could be read are still listed.
 */
export class Declaration {
	/**
	 * Reads the declaration of a workspace root
	 *
	 * @param {string} root The directory of the workspace, or of a standalone package; canonicalized
	 * @returns {Declaration}
	 */
	static read(root) {
		return new Declaration(root);
	}

	#root;

	/**
	 * The canonical directory of the workspace, or of the standalone package
	 */
	get root() {
		return this.#root;
	}

	#kind;

	/**
	 * `npm`, `beyond-json` or `standalone`
	 */
	get kind() {
		return this.#kind;
	}

	#manifest;

	/**
	 * The `package.json` of the root, when it is a readable JSON object
	 *
	 * @returns {object | undefined}
	 */
	get manifest() {
		return this.#manifest;
	}

	#members;

	/**
	 * The members, in declaration order: `{id, path, name, version, manifest, source}`, where `path` is
	 * canonical and `source` is `workspaces`, `beyond.workspaces`, `beyond.json` or `standalone`
	 */
	get members() {
		return this.#members;
	}

	#diagnostics;

	/**
	 * `{code, message, severity, paths?}`, errors and warnings, in the order they were found
	 */
	get diagnostics() {
		return this.#diagnostics;
	}

	/**
	 * Whether the declaration has no error
	 */
	get valid() {
		return !this.#diagnostics.some(({ severity }) => severity === 'error');
	}

	#inputs;

	/**
	 * `{declaration, members: {[id]: digest}}`, each digest `sha256-<hex>`
	 */
	get inputs() {
		return this.#inputs;
	}

	/**
	 * Use `Declaration.read(root)`
	 *
	 * @param {string} root
	 */
	constructor(root) {
		const diagnostics = new Diagnostics();
		const members = new Members(diagnostics);
		const real = Paths.real(root);
		this.#root = real ?? resolve(root);

		const configuration = new Configuration(this.#root);
		if (real === undefined) {
			diagnostics.error('MEMBER_NOT_FOUND', `"${this.#root}" is not an existing directory`, [this.#root]);
		} else {
			Declaration.#check(configuration, diagnostics);
			new Entries(configuration, diagnostics).list.forEach(entry => members.add(entry));
			members.check();
		}

		this.#kind = configuration.kind;
		this.#manifest = configuration.manifest.content;
		this.#members = Object.freeze(members.list);
		this.#diagnostics = Object.freeze(diagnostics.list);
		this.#inputs = Inputs.compute({ kind: this.#kind, members: this.#members, manifest: this.#manifest });
	}

	/**
	 * A root manifest that is there and cannot be read leaves the declaration undecided, whatever the kind it
	 * was taken for: whether it declares members, and what the root depends on, cannot be told. The kind is
	 * then decided by the files that exist, and a root that is also a member reports its manifest as a member
	 * as well.
	 */
	static #check({ manifest }, diagnostics) {
		if (!manifest.error) return;
		const message =
			`The root manifest "${manifest.path}" cannot be read: ${manifest.error}. ` +
			`What it declares (members, dependencies) cannot be told until it is corrected`;
		diagnostics.error('WORKSPACE_CONFIG_INVALID', message, [manifest.path]);
	}

	/**
	 * The member whose directory is exactly a path, compared by canonical identity
	 *
	 * @param {string} path
	 */
	member(path) {
		const canonical = Paths.canonical(path);
		return this.#members.find(member => member.path === canonical);
	}

	/**
	 * The member whose directory contains a path, the deepest one when members are nested
	 *
	 * @param {string} path A directory or a file, existing or not
	 */
	owner(path) {
		const canonical = Paths.canonical(path);
		let found;
		for (const member of this.#members) {
			if (!Paths.contains(member.path, canonical)) continue;
			if (!found || member.path.length > found.path.length) found = member;
		}
		return found;
	}
}
