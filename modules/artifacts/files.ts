import type { ESMConditional } from '@beyond-js/packages/sdk';
import { promises as fs } from 'fs';
import { join, dirname, posix, relative, sep } from 'path';

/**
 * The files of one build in the artifacts directory.
 *
 * A build owns every file named after its conditions. What it does not write again is removed when it
 * ends: the artifact of a module that stopped compiling, that lost a dependency or that is no longer
 * declared must not stay reachable, because a consumer reading the directory cannot tell it from a current
 * one. Files of other conditions belong to other builds and are left alone.
 */
export class Files {
	#path: string;
	#conditions: string;
	#written: Set<string> = new Set();

	/**
	 * @param path The artifacts directory
	 * @param key The key of the requested conditions, such as `node` or `node/development`
	 */
	constructor(path: string, key: string) {
		this.#path = path;
		this.#conditions = key.replace('/', '.');
	}

	/**
	 * The file of a public module artifact, relative to the artifacts directory.
	 *
	 * The versioned package directory keeps two versions of one package apart, and the conditions are part
	 * of the file name so that several conditionals of one module coexist.
	 */
	name(vname: string, subpath: string, patch: boolean): string {
		const name = subpath === '.' ? 'index' : subpath.replace(/^\.\//, '');
		return posix.join(vname, `${name}.${this.#conditions}${patch ? '.hmr' : ''}.mjs`);
	}

	/**
	 * Writes the artifact of a conditional, its source map and its update
	 */
	async write(conditional: ESMConditional, file: string, patch: string): Promise<void> {
		const target = join(this.#path, file);
		await fs.mkdir(dirname(target), { recursive: true });

		/**
		 * The source map is written next to the artifact and referenced by it. The reference comment is
		 * assembled from its parts because a literal one in this source would be consumed by the compiler
		 * that packages this implementation.
		 */
		const reference = `${['//#', 'sourceMappingURL'].join(' ')}=${posix.basename(file)}.map`;
		await fs.writeFile(target, `${conditional.output.code()}\n${reference}\n`);
		await fs.writeFile(`${target}.map`, conditional.output.map());

		// The update carries its map inline: it is imported by URL, with no sibling file to resolve
		await fs.writeFile(join(this.#path, patch), conditional.patch.code('sourcemap-inline'));

		[file, `${file}.map`, patch].forEach(written => this.#written.add(written));
	}

	/**
	 * Removes the files of these conditions that this build did not write
	 *
	 * @returns The removed files, relative to the artifacts directory
	 */
	async prune(): Promise<string[]> {
		// Only what `name()` can produce is owned: a versioned package directory and the suffix of the conditions
		const suffix = `\\.${this.#conditions.replace(/\./g, '\\.')}(\\.hmr)?\\.mjs(\\.map)?$`;
		const owned = new RegExp(`^(@[^/]+/)?[^/@]+@[^/]+/.*${suffix}`);
		const removed: string[] = [];

		const visit = async (directory: string) => {
			const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);
			for (const entry of entries) {
				const path = join(directory, entry.name);
				if (entry.isDirectory()) {
					await visit(path);
					continue;
				}

				const file = relative(this.#path, path).split(sep).join(posix.sep);
				if (!owned.test(file) || this.#written.has(file)) continue;
				await fs.rm(path, { force: true });
				removed.push(file);
			}
		};

		await visit(this.#path);
		return removed;
	}
}
