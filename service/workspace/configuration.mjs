import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Manifest } from './manifest.mjs';

/**
 * The configuration files of a directory, and the kind of workspace root they make of it:
 *
 * - `beyond-json`: its `beyond.json` names the members in a non-empty `packages`.
 * - `npm`: its `package.json` declares `workspaces` (npm's field, an array of patterns or an object with a
 *   `packages` array) or `beyond.workspaces` (the Beyond extension for what npm cannot express, such as a
 *   second package with the name of another member).
 * - `standalone`: neither; the directory is one package on its own.
 *
 * A `beyond.json` declares members only through a non-empty `packages`. One without it (absent, `null`, empty)
 * holds other declarations of the workspace, such as its `applications`, and never decides the kind: the manifest
 * does, so declaring the first application of a package changes nothing its installed graph was made from. One that
 * cannot be read leaves untold whether it names members: beside a manifest that declares them it is a warning and
 * the manifest's members stay, and otherwise it is the error of a `beyond-json` root that cannot be used.
 *
 * A directory whose `beyond.json` declares `packages` and whose `package.json` also declares members is in
 * conflict: the two are never merged. Reading the files is synchronous and limited to this directory, and
 * `beyond.json` is read once.
 */
export class Configuration {
	#directory;

	/**
	 * The directory whose configuration this is
	 */
	get directory() {
		return this.#directory;
	}

	#manifest;

	/**
	 * The `package.json` of the directory
	 *
	 * @returns {Manifest}
	 */
	get manifest() {
		return this.#manifest;
	}

	#file;

	/**
	 * The path of the `beyond.json` of the directory, whether it exists or not
	 */
	get file() {
		return this.#file;
	}

	#configured;

	/**
	 * Whether the directory holds a `beyond.json`
	 */
	get configured() {
		return this.#configured;
	}

	/**
	 * The `workspaces` of the manifest, undefined when it declares none
	 */
	get workspaces() {
		return this.#manifest.content?.workspaces;
	}

	/**
	 * The `workspaces` of the `beyond` object of the manifest (the Beyond extension), undefined when it
	 * declares none
	 */
	get extension() {
		const { beyond } = this.#manifest.content ?? {};
		const object = beyond !== null && typeof beyond === 'object' && !Array.isArray(beyond);
		return object ? beyond.workspaces : void 0;
	}

	/**
	 * Whether the manifest declares members, through `workspaces` or `beyond.workspaces`
	 */
	get declared() {
		return this.workspaces !== undefined || this.extension !== undefined;
	}

	/**
	 * Whether the directory is the root of a workspace: it holds a `beyond.json`, or its manifest declares
	 * members
	 */
	get root() {
		return this.#configured || this.declared;
	}

	/**
	 * Whether the `beyond.json` of the directory names members in `packages`, as a `beyond-json` root reads them: a
	 * value that is absent, `null`, empty (`[]`, `""`) or otherwise false declares none, and any other value is an
	 * attempt to (a list that is not one is then the error of `Entries`). A file that cannot be read, or that is not a
	 * JSON object, declares none that can be told (see `read()`).
	 */
	get packages() {
		if (!this.#configured) return false;
		const { packages } = this.read().value ?? {};
		return Array.isArray(packages) ? packages.length > 0 : !!packages;
	}

	/**
	 * Whether the directory holds a `beyond.json` that cannot be read as a JSON object
	 */
	get unreadable() {
		return this.#configured && !!this.read().error;
	}

	/**
	 * Whether members are declared both in `beyond.json` (`packages`) and in the manifest
	 */
	get conflict() {
		return this.declared && this.packages;
	}

	/**
	 * `beyond-json`, `npm` or `standalone`. A directory in conflict is `beyond-json`, with no member. A `beyond.json`
	 * without `packages` leaves the kind to the manifest: `npm` when it declares members, else `standalone`. One that
	 * cannot be read is `beyond-json` (an error) unless the manifest declares members.
	 */
	get kind() {
		if (this.packages) return 'beyond-json';
		if (this.declared) return 'npm';
		return this.unreadable ? 'beyond-json' : 'standalone';
	}

	/**
	 * @param {string} directory
	 */
	constructor(directory) {
		this.#directory = directory;
		this.#manifest = new Manifest(directory);
		this.#file = join(directory, 'beyond.json');
		this.#configured = existsSync(this.#file);
	}

	#read;

	/**
	 * Reads the `beyond.json` of the directory, once: what decides the kind and what names the members are the same
	 * reading of the file
	 *
	 * @returns {{value?: object, error?: string}} The configuration when it is a JSON object, else why not
	 */
	read() {
		return (this.#read ??= this.#parse());
	}

	#parse() {
		let value;
		try {
			value = JSON.parse(readFileSync(this.#file, 'utf8'));
		} catch (error) {
			const reason = error.code ? `it cannot be read (${error.code})` : `it is not valid JSON (${error.message})`;
			return { error: reason };
		}

		const object = value !== null && typeof value === 'object' && !Array.isArray(value);
		return object ? { value } : { error: 'it is not a JSON object' };
	}
}
