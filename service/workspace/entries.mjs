import { existsSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import semver from 'semver';
import { Patterns } from './patterns.mjs';
import { Paths } from './paths.mjs';

/**
 * The directories that the configuration of a workspace root names as its members, in declaration order and
 * before they are read. Each entry is `{id, directory, source, literal, version?}`: `id` is its path relative
 * to the root in POSIX form, `directory` its absolute path as declared (not yet canonical), `literal` whether
 * it was named exactly (and so must exist) rather than matched by a pattern, and `version` the version a
 * `beyond.workspaces` entry asserts.
 *
 * - `npm`: the patterns of `workspaces`, then the entries of `beyond.workspaces` (patterns, or `{path,
 *   version?}` objects naming one directory by its path relative to the root), each list with npm's pattern
 *   semantics. A pattern match is an entry only when it holds a `package.json`, and a pattern that yields
 *   none is reported.
 * - `beyond-json`: the `packages` of `beyond.json`, as Packages has always read them: literal paths relative
 *   to the root, each a directory or its `package.json`, never absolute nor outside the root; the root alone
 *   when there are none.
 * - `standalone`: the root itself.
 *
 * Problems of the configuration are recorded in the diagnostics it is given.
 */
export class Entries {
	#configuration;
	#diagnostics;
	#list = [];

	/**
	 * The entries, in declaration order
	 */
	get list() {
		return [...this.#list];
	}

	/**
	 * @param {import('./configuration.mjs').Configuration} configuration
	 * @param {import('./diagnostics.mjs').Diagnostics} diagnostics
	 */
	constructor(configuration, diagnostics) {
		this.#configuration = configuration;
		this.#diagnostics = diagnostics;

		const { kind } = configuration;
		if (configuration.conflict) return void this.#conflict();
		kind === 'beyond-json' ? this.#file() : kind === 'npm' ? this.#npm() : this.#add('.', 'standalone', true);
	}

	#conflict() {
		const { directory, file, manifest } = this.#configuration;
		const message =
			`The workspace "${directory}" declares its members both in beyond.json and in its package.json ` +
			`("workspaces" or "beyond.workspaces"). They are never merged: keep only one of them`;
		this.#diagnostics.error('WORKSPACE_CONFIG_CONFLICT', message, [file, manifest.path]);
	}

	#npm() {
		const { workspaces, extension, manifest } = this.#configuration;
		const file = manifest.path;

		if (workspaces !== undefined) {
			const list = Array.isArray(workspaces) ? workspaces : workspaces?.packages;
			const expected = 'an array of patterns, or an object with a "packages" array of them';
			Array.isArray(list)
				? this.#patterns(list, 'workspaces')
				: this.#invalid(`"workspaces" of "${file}" must be ${expected}`);
		}

		if (extension !== undefined) {
			const expected = 'an array of patterns and {path, version} objects';
			Array.isArray(extension)
				? this.#patterns(extension, 'beyond.workspaces')
				: this.#invalid(`"beyond.workspaces" of "${file}" must be ${expected}`);
		}
	}

	/**
	 * The entries of one list of `workspaces` or `beyond.workspaces`, in their order
	 */
	#patterns(list, source) {
		const file = this.#configuration.manifest.path;
		const patterns = new Patterns(this.#configuration.directory, list);
		const expansions = new Map(patterns.expand().map(found => [found.index, found]));

		list.forEach((entry, index) => {
			if (typeof entry === 'string' && entry) {
				// A negation, or a pattern that a negation removed, has no expansion of its own
				const found = expansions.get(index);
				if (found) this.#expansion(found, source);
				return;
			}

			const object = entry !== null && typeof entry === 'object' && !Array.isArray(entry);
			if (source === 'beyond.workspaces' && object) return void this.#object(entry, index);

			const expected = source === 'workspaces' ? 'a pattern' : 'a pattern or a {path, version} object';
			const found = JSON.stringify(entry);
			this.#invalid(`The entry ${index} of "${source}" in "${file}" is not ${expected}: ${found}`);
		});
	}

	#expansion({ pattern, paths, error }, source) {
		const { directory, manifest } = this.#configuration;
		const named = `The pattern "${pattern}" of "${source}" in "${manifest.path}"`;
		if (error) return void this.#invalid(`${named} cannot be expanded: ${error}`);

		// As npm does, a match that holds no package.json is not a package and is skipped without a word
		const packages = paths.filter(path => existsSync(join(resolve(directory, path), 'package.json')));
		if (!packages.length) {
			const message = `${named} matches no package`;
			return void this.#diagnostics.warning('WORKSPACE_PATTERN_EMPTY', message, [manifest.path]);
		}
		packages.forEach(path => this.#add(path, source, false));
	}

	/**
	 * A `{path, version?}` entry of `beyond.workspaces`: exactly one directory, relative to the root, never a
	 * pattern. It is not read with the rules of a pattern: an absolute path is refused, not taken as relative.
	 */
	#object({ path, version }, index) {
		const file = this.#configuration.manifest.path;
		if (typeof path !== 'string' || !path) {
			return void this.#invalid(`The entry ${index} of "beyond.workspaces" in "${file}" has no "path" string`);
		}

		const portable = path.replace(/\\/g, '/');
		if (isAbsolute(path) || portable.startsWith('/')) {
			const message =
				`The entry ${index} of "beyond.workspaces" in "${file}" names the absolute path "${path}". ` +
				`Name the directory relative to the root, as "../${basename(portable)}" names a sibling of it`;
			return void this.#invalid(message);
		}
		if (version !== undefined && (typeof version !== 'string' || semver.valid(version) !== version)) {
			const message =
				`The entry ${index} of "beyond.workspaces" in "${file}" asserts the version ` +
				`${JSON.stringify(version)}, which is not a version in canonical semver form`;
			return void this.#invalid(message);
		}

		this.#add(portable, 'beyond.workspaces', true, version);
	}

	#file() {
		const { directory: root, file } = this.#configuration;
		const { value, error } = this.#configuration.read();
		if (error) return void this.#invalid(`The workspace configuration "${file}" cannot be used: ${error}`, file);

		const { packages } = value;
		if (packages && !Array.isArray(packages)) {
			return void this.#invalid(`"packages" of "${file}" must be an array of strings`, file);
		}

		const skipped = message => this.#diagnostics.warning('INVALID_PACKAGE_PATH', message, [file]);
		for (const entry of packages || ['.']) {
			if (typeof entry !== 'string' || !entry) {
				skipped(`Each package path of "${file}" must be a non-empty string. Found: ${JSON.stringify(entry)}`);
				continue;
			}
			if (isAbsolute(entry)) {
				skipped(`Package paths of "${file}" cannot be absolute. Found: ${entry}`);
				continue;
			}

			const absolute = resolve(root, entry);
			const directory = basename(absolute) === 'package.json' ? dirname(absolute) : absolute;
			if (!Paths.contains(root, directory)) {
				skipped(`Package paths of "${file}" cannot point to parent directories. Found: ${entry}`);
				continue;
			}
			this.#add(Paths.id(root, directory), 'beyond.json', true);
		}
	}

	#add(path, source, literal, version) {
		const directory = resolve(this.#configuration.directory, path);
		const entry = { id: Paths.id(this.#configuration.directory, directory), directory, source, literal };
		if (version !== undefined) entry.version = version;
		this.#list.push(Object.freeze(entry));
	}

	#invalid(message, file = this.#configuration.manifest.path) {
		this.#diagnostics.error('WORKSPACE_CONFIG_INVALID', message, [file]);
	}
}
