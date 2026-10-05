import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Manifest } from './manifest.mjs';

/**
 * The configuration files of a directory, and the kind of workspace root they make of it:
 *
 * - `beyond-json`: it holds a `beyond.json`, whose `packages` name the members (the root alone by default).
 * - `npm`: its `package.json` declares `workspaces` (npm's field, an array of patterns or an object with a
 *   `packages` array) or `beyond.workspaces` (the Beyond extension for what npm cannot express, such as a
 *   second package with the name of another member).
 * - `standalone`: neither; the directory is one package on its own.
 *
 * A directory that holds a `beyond.json` and also declares members in its `package.json` is in conflict:
 * the two are never merged. Reading the files is synchronous and limited to this directory.
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
	 * Whether members are declared both in `beyond.json` and in the manifest
	 */
	get conflict() {
		return this.#configured && this.declared;
	}

	/**
	 * `beyond-json`, `npm` or `standalone`. A directory in conflict is `beyond-json`, with no member.
	 */
	get kind() {
		return this.#configured ? 'beyond-json' : this.declared ? 'npm' : 'standalone';
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

	/**
	 * Reads the `beyond.json` of the directory
	 *
	 * @returns {{value?: object, error?: string}} The configuration when it is a JSON object, else why not
	 */
	read() {
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
