import { Manifest } from './manifest.mjs';
import { Paths } from './paths.mjs';

/**
 * The members of a workspace, read from the entries its configuration declares.
 *
 * The identity of a member is its canonical directory: a directory reached twice, through two patterns or
 * through a symbolic link and its target, is one member, named by the first entry that reached it. Every
 * member is kept, even one whose manifest is unusable, so that whoever asks which package a directory
 * belongs to still gets the answer; what is wrong is recorded in the diagnostics:
 *
 * - `MEMBER_NOT_FOUND`: a directory named exactly does not exist or holds no `package.json`.
 * - `MEMBER_MANIFEST_INVALID`: the manifest has no string `name` or no canonical semver `version`.
 * - `MEMBER_VERSION_MISMATCH`: a `beyond.workspaces` entry asserts a version the manifest does not have.
 * - `WORKSPACE_INSTANCE_DUPLICATED`: one name and version at two directories, whatever declared them.
 * - `WORKSPACE_NAME_DUPLICATED`: one name at two directories inside `workspaces`, which npm refuses;
 *   another version of a name belongs in `beyond.workspaces`. Two copies of one release there are both.
 *
 * A member is `{id, path, name, version, manifest, source}`, frozen.
 */
export class Members {
	#diagnostics;
	#list = [];
	#paths = new Map();
	#invalid = new Set();

	/**
	 * The members, in the order they were declared
	 */
	get list() {
		return [...this.#list];
	}

	/**
	 * @param {import('./diagnostics.mjs').Diagnostics} diagnostics
	 */
	constructor(diagnostics) {
		this.#diagnostics = diagnostics;
	}

	/**
	 * Reads the member an entry names
	 *
	 * @param {{id: string, directory: string, source: string, literal: boolean, version?: string}} entry
	 */
	add({ id, directory, source, literal, version }) {
		const path = Paths.real(directory);
		const manifest = path === undefined ? undefined : new Manifest(path);
		if (!manifest?.exists) {
			// A pattern match without a package.json is no package; a directory named exactly must be one
			if (!literal) return;
			const message = `The member "${id}" (${path ?? directory}) does not exist or holds no package.json`;
			return void this.#diagnostics.error('MEMBER_NOT_FOUND', message, [path ?? directory]);
		}

		const member = this.#paths.get(path) ?? this.#create(id, path, source, manifest);
		if (version !== undefined && member.version !== version) {
			const message =
				`The member "${id}" is declared at version ${version}, but its manifest (${manifest.path}) ` +
				`says ${member.version ?? 'nothing'}. ` +
				`The manifest is authoritative: correct the declaration or the manifest`;
			this.#diagnostics.error('MEMBER_VERSION_MISMATCH', message, [manifest.path]);
		}
	}

	#create(id, path, source, manifest) {
		const { problem } = manifest;
		const member = Object.freeze({
			id,
			path,
			name: manifest.name,
			version: manifest.version,
			manifest: manifest.content ?? {},
			source
		});

		if (problem) {
			this.#invalid.add(member);
			const message = `The member "${id}" cannot be used: ${problem} (${manifest.path})`;
			this.#diagnostics.error('MEMBER_MANIFEST_INVALID', message, [manifest.path]);
		}

		this.#paths.set(path, member);
		this.#list.push(member);
		return member;
	}

	/**
	 * Reports the releases and names that more than one member claims. Called once every entry was added.
	 */
	check() {
		const usable = this.#list.filter(member => !this.#invalid.has(member));

		for (const [release, members] of Members.#group(usable, ({ name, version }) => `${name}@${version}`)) {
			if (members.length < 2) continue;
			const message =
				`${release} is provided by more than one directory: ${Members.#names(members)}. ` +
				`A release has one location in a workspace: keep only one of them`;
			this.#diagnostics.error('WORKSPACE_INSTANCE_DUPLICATED', message, members.map(({ path }) => path));
		}

		const declared = usable.filter(({ source }) => source === 'workspaces');
		for (const [name, members] of Members.#group(declared, ({ name }) => name)) {
			if (members.length < 2) continue;
			const message =
				`"${name}" is the name of more than one member of "workspaces": ${Members.#names(members)}. ` +
				`npm allows one directory per name there: keep one, and declare another version in "beyond.workspaces"`;
			this.#diagnostics.error('WORKSPACE_NAME_DUPLICATED', message, members.map(({ path }) => path));
		}
	}

	static #group(list, key) {
		const groups = new Map();
		list.forEach(item => groups.set(key(item), [...(groups.get(key(item)) ?? []), item]));
		return groups;
	}

	static #names(members) {
		return members.map(({ id, version, path }) => `"${id}" (${version}, ${path})`).join(', ');
	}
}
