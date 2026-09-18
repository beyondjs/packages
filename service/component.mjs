import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, sep } from 'node:path';

/**
 * One installed component: where it is, which version it is and where its installed dependencies are
 */
export class Component {
	#path;
	get path() {
		return this.#path;
	}

	#manifest;
	get manifest() {
		return this.#manifest;
	}

	get version() {
		return this.#manifest.version;
	}

	#host;

	/**
	 * @param {string} manifest The package.json of the component
	 * @param {Component} [host] The component this one is distributed inside of, whose installed
	 * dependencies are therefore the ones it resolves
	 */
	constructor(manifest, host) {
		this.#path = realpathSync(dirname(manifest));
		this.#manifest = JSON.parse(readFileSync(manifest, 'utf8'));
		this.#host = host;
	}

	/**
	 * Locates an installed package by name, as seen from a module. A package whose `exports` hide its
	 * manifest is found from its entry point, walking up to the manifest that carries its name.
	 *
	 * @param {string} name
	 * @param {string} from The URL of the module that depends on the package
	 */
	static installed(name, from) {
		const require = createRequire(from);
		try {
			return new Component(require.resolve(`${name}/package.json`));
		} catch (error) {
			if (error.code !== 'ERR_PACKAGE_PATH_NOT_EXPORTED') throw error;
		}

		for (let current = dirname(require.resolve(name)); dirname(current) !== current; current = dirname(current)) {
			const manifest = join(current, 'package.json');
			if (existsSync(manifest) && JSON.parse(readFileSync(manifest, 'utf8')).name === name) return new Component(manifest);
		}
		throw new Error(`The installed package "${name}" has no manifest`);
	}

	/**
	 * The directory whose installed packages this component resolves: its own `node_modules` in a checkout,
	 * or the one it was installed into, where a package manager hoisted its dependencies
	 */
	get modules() {
		if (this.#host) return this.#host.modules;

		const own = join(this.#path, 'node_modules');
		if (existsSync(own)) return own;

		for (let current = this.#path; dirname(current) !== current; current = dirname(current)) {
			if (current.endsWith(`${sep}node_modules`)) return current;
		}
		throw new Error(`No node_modules directory serves "${this.#path}"`);
	}
}
