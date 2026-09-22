import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The local packages a bootstrap serves instead of the copies the installation resolved from the registry.
 *
 * Packages resolves its utilities as ordinary installed dependencies, so a change in one of them reaches
 * nothing that runs until a new version is published. Serving the package from its sources removes that
 * step: the compiler registers it, the loader of the host is given its origin, and the specifier resolves
 * there instead of in `node_modules`.
 *
 * The selection is explicit. `BEYOND_LOCAL_PACKAGES` names it:
 *
 * - unset: the default set below, whose sources this package carries
 * - `none`: nothing, which is the registry-backed operation of an ordinary installation
 * - a list of package names, separated by commas or whitespace, each optionally `name=<directory>` to take
 *   its sources from a checkout instead of the ones carried here
 *
 * A selected package whose sources are not where they are expected fails the start of the service. It is
 * never silently replaced by the installed copy, because a selection that is quietly ignored would report a
 * repair that never ran.
 */
export class Selection {
	/** The packages served locally when nothing else is configured */
	static DEFAULT = ['@beyond-js/dynamic-processor', '@beyond-js/finder', '@beyond-js/watchers'];

	/**
	 * Where the sources this package carries live, and which directory of each one holds its Beyond package.
	 * A utility whose manifest is not at the root of its repository, such as the dynamic processor, names it.
	 */
	static CARRIED = new Map([
		['@beyond-js/dynamic-processor', { resource: 'dynamic-processor', source: 'src' }],
		['@beyond-js/finder', { resource: 'finder' }],
		['@beyond-js/watchers', { resource: 'watchers' }]
	]);

	#entries = [];

	/**
	 * The selected packages, each with the directory its sources are staged from
	 *
	 * @returns {{name: string, path: string}[]}
	 */
	get entries() {
		return this.#entries;
	}

	/**
	 * @param {string | undefined} [value] `BEYOND_LOCAL_PACKAGES`
	 */
	constructor(value = process.env.BEYOND_LOCAL_PACKAGES) {
		const configured = (value ?? '').trim();
		if (configured === 'none') return;

		const names = configured ? configured.split(/[\s,]+/).filter(Boolean) : Selection.DEFAULT;
		for (const entry of names) {
			const [name, directory] = entry.includes('=') ? entry.split(/=(.*)/s) : [entry, undefined];
			this.#entries.push({ name, path: this.#source(name, directory) });
		}
	}

	/**
	 * Whether a package is served locally, which is what decides whether the host is given its origin
	 */
	has(name) {
		return this.#entries.some(entry => entry.name === name);
	}

	/**
	 * Where the sources of a selected package are, checked here so that an unavailable selection fails the
	 * start of the service with the name of what is missing
	 */
	#source(name, directory) {
		const carried = Selection.CARRIED.get(name);
		const path = directory
			? join(resolve(directory), carried?.source ?? '')
			: carried && fileURLToPath(new URL(`./resources/${carried.resource}/${carried.source ?? ''}`, import.meta.url));

		if (!path) {
			const known = [...Selection.CARRIED.keys()].join(', ');
			throw new Error(
				`BEYOND_LOCAL_PACKAGES selects "${name}", whose sources this package does not carry. Name a ` +
					`directory ("${name}=<directory>") or select one of: ${known}.`
			);
		}
		Selection.source(name, path);
		return path;
	}

	/**
	 * Checks that a directory holds the sources of a package, so that what is missing is named where it is
	 * selected rather than where the compiler fails to find a project
	 *
	 * @param {string} name
	 * @param {string} path
	 */
	static source(name, path) {
		if (existsSync(join(path, 'package.json'))) return path;
		throw new Error(
			`The sources of "${name}" are not at "${path}". In a checkout, generate the ones this package ` +
				`carries with "npm run resources" in @beyond-js/packages-bootstrap; an installed package ` +
				`includes them.`
		);
	}
}
