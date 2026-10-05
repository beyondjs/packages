/**
 * The releases the fixture registry publishes, read from the checked-in directories of
 * `fixtures/acceptance/registry/<set>/`: each directory holding a `package.json` is one release, whose other files
 * become the files of its archive. The registry itself is the in-process npm-compatible registry of the CDN
 * resolution validation, which counts and logs every request it receives.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { FakeRegistry } from '../../cdn-resolution/registry.mjs';
import { Layout } from './layout.mjs';

export class Catalog {
	/**
	 * Where the release sets are
	 */
	static ROOT = join(Layout.FIXTURES, 'registry');

	/**
	 * Starts a registry on an allocated port, below the path prefix `/npm`, publishing the given sets
	 *
	 * @param {string[]} sets Names of directories of the catalog, `initial` by default
	 * @param {{prefix?: string, token?: string}} [options] Another prefix, and the bearer token every request
	 *   must carry for a registry that serves nobody anonymously
	 * @returns {Promise<FakeRegistry>}
	 */
	static async registry(sets = ['initial'], options = {}) {
		const registry = await new FakeRegistry({ prefix: '/npm', ...options }).start();
		try {
			for (const set of sets) await Catalog.publish(registry, set);
		} catch (error) {
			await registry.stop();
			throw error;
		}
		return registry;
	}

	/**
	 * The address of a registry that is no longer there: one is started on an allocated port and stopped, so a
	 * request to it is refused at once, as an unavailable registry refuses it
	 */
	static async unreachable() {
		const registry = await new FakeRegistry({ prefix: '/npm' }).start();
		const { url } = registry;
		await registry.stop();
		return url;
	}

	/**
	 * Publishes every release of a set
	 *
	 * @returns {Promise<string[]>} The `name@version` of each release published
	 */
	static async publish(registry, set) {
		const published = [];
		for (const directory of Catalog.#releases(join(Catalog.ROOT, set))) {
			const manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));
			const files = {};
			for (const file of Catalog.#files(directory)) {
				if (file !== 'package.json') files[file] = readFileSync(join(directory, file), 'utf8');
			}
			await registry.publish({ ...manifest, files });
			published.push(`${manifest.name}@${manifest.version}`);
		}
		return published;
	}

	/**
	 * The release directories below a set, sorted
	 */
	static #releases(directory) {
		const entries = readdirSync(directory).sort();
		if (entries.includes('package.json')) return [directory];
		return entries
			.map(entry => join(directory, entry))
			.filter(path => statSync(path).isDirectory())
			.flatMap(path => Catalog.#releases(path));
	}

	/**
	 * The files of a release, relative to it with `/` separators
	 */
	static #files(directory, root = directory) {
		return readdirSync(directory)
			.sort()
			.flatMap(entry => {
				const path = join(directory, entry);
				if (statSync(path).isDirectory()) return Catalog.#files(path, root);
				return [relative(root, path).split(sep).join('/')];
			});
	}
}
