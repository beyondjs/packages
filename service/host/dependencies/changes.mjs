import semver from 'semver';
import { DependencyError } from './error.mjs';

/**
 * The changes a plan is asked for (`POST /dependencies/plans {changes}`), validated before anything runs:
 * `[{name, importer?, range?, version?}]`.
 *
 * - `name` is the package whose selection changes; `importer` the member id (`.` for the root importer) whose manifest
 *   a `range` is written to. Without `importer`, a `range` is written to every importer that declares the name.
 * - `range` changes what the importer declares (written to its manifest when the plan is applied); a name the importer
 *   does not declare yet is added to its `dependencies`.
 * - `version` is the exact release preferred wherever the declared ranges admit it.
 * - With neither, the name's locked selections are released, so the newest release every range admits is chosen.
 */
export class Changes {
	static LIMIT = 50;
	// A package name, legacy ones with capitals included: what a registry publishes and a manifest may declare
	static #NAME = /^(@[A-Za-z0-9~][A-Za-z0-9-._~]*\/)?[A-Za-z0-9~][A-Za-z0-9-._~]*$/;

	#list;

	/**
	 * @param {unknown} value The `changes` of a request
	 * @throws {DependencyError} `CHANGES_INVALID`
	 */
	constructor(value) {
		if (!Array.isArray(value) || !value.length) throw Changes.#invalid('A plan needs a non-empty list of changes');
		if (value.length > Changes.LIMIT) throw Changes.#invalid(`A plan takes at most ${Changes.LIMIT} changes`);
		this.#list = value.map((change, index) => Changes.#check(change, index));
		const keys = this.#list.map(({ name, importer }) => `${name}\u0000${importer ?? ''}`);
		if (new Set(keys).size !== keys.length) throw Changes.#invalid('A name is changed once per importer');
	}

	static #invalid(message) {
		return new DependencyError('CHANGES_INVALID', message);
	}

	static #check(change, index) {
		const at = `changes[${index}]`;
		if (!change || typeof change !== 'object' || Array.isArray(change)) throw Changes.#invalid(`${at} is not an object`);
		const unknown = Object.keys(change).filter(key => !['name', 'importer', 'range', 'version'].includes(key));
		if (unknown.length) throw Changes.#invalid(`${at} has an unknown field "${unknown[0]}" (expected name, importer, range, version)`);
		const { name, importer, range, version } = change;
		if (typeof name !== 'string' || name.length > 214 || !Changes.#NAME.test(name)) throw Changes.#invalid(`${at}.name is not a package name`);
		if (importer !== undefined && (typeof importer !== 'string' || !importer || importer.length > 512 || /[\u0000-\u001f]/.test(importer))) {
			throw Changes.#invalid(`${at}.importer is not a member id`);
		}
		if (range !== undefined && (typeof range !== 'string' || !range.trim() || range.length > 256 || /[\u0000-\u001f]/.test(range))) {
			throw Changes.#invalid(`${at}.range is not a range`);
		}
		if (version !== undefined && (typeof version !== 'string' || !semver.valid(version) || semver.clean(version) !== version)) {
			throw Changes.#invalid(`${at}.version is not an exact version`);
		}
		return { name, ...(importer !== undefined ? { importer } : {}), ...(range !== undefined ? { range: range.trim() } : {}), ...(version !== undefined ? { version } : {}) };
	}

	get list() {
		return this.#list.map(change => ({ ...change }));
	}

	/**
	 * The names the changes ask for
	 */
	get names() {
		return [...new Set(this.#list.map(({ name }) => name))];
	}

	/**
	 * Where each change writes and what it pins, read against the importers of the workspace
	 *
	 * @param {{id: string, manifest: object}[]} importers
	 * @returns {{writes: {importer: string, group: string, name: string, range: string}[], pins: {name: string,
	 * version: string}[], released: string[]}}
	 * @throws {DependencyError} `CHANGE_UNDECLARED` for an importer that is not one, or a change of a name nobody
	 * declares that names no importer and no range to add it with
	 */
	resolve(importers) {
		const writes = [];
		const pins = [];
		const released = [];
		for (const change of this.#list) {
			const { name, importer, range, version } = change;
			if (importer !== undefined && !importers.some(({ id }) => id === importer)) {
				throw new DependencyError('CHANGE_UNDECLARED', `The workspace has no importer "${importer}"`, { change });
			}
			const named = importer !== undefined ? importers.filter(({ id }) => id === importer) : importers;
			const declaring = named.filter(one => Changes.groups(one.manifest, name).length);
			if (!declaring.length && !(importer !== undefined && range !== undefined)) {
				const where = importer !== undefined ? `"${importer}" does not declare` : 'No importer declares';
				const how = importer !== undefined ? 'give a range to add it' : 'name an importer and a range to add it';
				throw new DependencyError('CHANGE_UNDECLARED', `${where} "${name}": ${how}`, { change });
			}
			if (range !== undefined) {
				const targets = declaring.length ? declaring : named;
				for (const one of targets) {
					const groups = Changes.groups(one.manifest, name);
					for (const group of groups.length ? groups : ['dependencies']) writes.push({ importer: one.id, group, name, range });
				}
			}
			if (version !== undefined) pins.push({ name, version });
			if (range === undefined && version === undefined) released.push(name);
		}
		return { writes, pins, released };
	}

	/**
	 * The groups of a manifest a range change of a name is written to: those that install it (`dependencies`,
	 * `devDependencies`, `optionalDependencies`); `peerDependencies` only when it is the one group that declares it,
	 * because a peer range states what a library accepts, not what it is developed against
	 */
	static groups(manifest, name) {
		const has = group => typeof manifest?.[group]?.[name] === 'string';
		const installed = ['dependencies', 'devDependencies', 'optionalDependencies'].filter(has);
		if (installed.length) return installed;
		return has('peerDependencies') ? ['peerDependencies'] : [];
	}
}
