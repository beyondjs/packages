import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import semver from 'semver';

/**
 * The `package.json` of a directory, read once. A manifest that exists can still be unusable: it may not be
 * readable, not be JSON or not be an object. A member of a workspace also needs a string `name` and a
 * `version` in canonical semver form (`1.2.3`, `1.2.3-beta.1`; no `v` prefix, no build metadata), because
 * its name and version identify the release it provides.
 */
export class Manifest {
	#path;

	/**
	 * The path of the `package.json` file
	 */
	get path() {
		return this.#path;
	}

	#exists = false;

	/**
	 * Whether there is a `package.json` in the directory, usable or not
	 */
	get exists() {
		return this.#exists;
	}

	#content;

	/**
	 * The manifest, when it is a readable JSON object
	 *
	 * @returns {object | undefined}
	 */
	get content() {
		return this.#content;
	}

	#error;

	/**
	 * Why a `package.json` that exists cannot be read as a JSON object, undefined when it can or when there
	 * is none
	 */
	get error() {
		return this.#error;
	}

	/**
	 * The `name` of the manifest when it is a non-empty string
	 */
	get name() {
		const { name } = this.#content ?? {};
		return typeof name === 'string' && name ? name : void 0;
	}

	/**
	 * The `version` of the manifest when it is a string, valid or not
	 */
	get version() {
		const { version } = this.#content ?? {};
		return typeof version === 'string' ? version : void 0;
	}

	/**
	 * Why the manifest cannot describe a member of a workspace, undefined when it can
	 */
	get problem() {
		if (!this.#exists) return 'there is no package.json';
		if (this.#error) return this.#error;
		if (!this.name) return 'it has no "name" string';

		const { version } = this;
		if (version === undefined) return 'it has no "version" string';
		const canonical = semver.valid(version) === version;
		if (!canonical) return `its version "${version}" is not a version in canonical semver form`;
	}

	/**
	 * @param {string} directory The directory that holds the manifest
	 */
	constructor(directory) {
		this.#path = join(directory, 'package.json');

		let text;
		try {
			text = readFileSync(this.#path, 'utf8');
			this.#exists = true;
		} catch (error) {
			// A directory that holds no package.json is not a package. A package.json that is there and cannot
			// be read (a directory, no permission) is a package whose manifest is unusable.
			if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return;
			this.#exists = true;
			this.#error = `it cannot be read (${error.code ?? error.message})`;
			return;
		}

		try {
			const content = JSON.parse(text);
			const object = content !== null && typeof content === 'object' && !Array.isArray(content);
			object ? (this.#content = content) : (this.#error = 'it is not a JSON object');
		} catch (error) {
			this.#error = `it is not valid JSON (${error.message})`;
		}
	}
}
