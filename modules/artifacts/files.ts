import type { ESMConditional } from '@beyond-js/packages/sdk';
import type { ConditionalOutput } from '@beyond-js/packages/module/output';
import { promises as fs } from 'fs';
import { join, dirname, posix, relative, sep, isAbsolute } from 'path';

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
		const extension = this.#conditions === 'types' ? 'd.ts' : 'mjs';
		return posix.join(vname, `${name}.${this.#conditions}${patch ? '.hmr' : ''}.${extension}`);
	}

	/**
	 * The stylesheet of a public module artifact, relative to the artifacts directory
	 */
	styles(vname: string, subpath: string): string {
		const name = subpath === '.' ? 'index' : subpath.replace(/^\.\//, '');
		return posix.join(vname, `${name}.${this.#conditions}.css`);
	}

	/**
	 * Writes the artifact of a conditional, its source map and its update
	 */
	async write(conditional: ESMConditional, file: string, patch: string, styles?: string): Promise<void> {
		const target = join(this.#path, file);
		await fs.mkdir(dirname(target), { recursive: true });

		// A declaration has no map and no update
		if (this.#conditions === 'types') {
			await fs.writeFile(target, `${conditional.output.code()}\n`);
			this.#written.add(file);
			return;
		}

		/**
		 * The source map is written next to the artifact and referenced by it. The reference comment is
		 * assembled from its parts because a literal one in this source would be consumed by the compiler
		 * that packages this implementation.
		 */
		const map = Files.portable(conditional.output.map(), target);
		const reference = map ? `${['//#', 'sourceMappingURL'].join(' ')}=${posix.basename(file)}.map\n` : '';
		await fs.writeFile(target, `${conditional.output.code()}\n${reference}`);
		this.#written.add(file);
		// A production conditional carries no map
		if (map) {
			await fs.writeFile(`${target}.map`, map);
			this.#written.add(`${file}.map`);
		}

		// The stylesheet of the module is written beside its code, with its own map
		styles && conditional.styles && (await this.sheet(conditional.styles, styles));

		// A packaged module has no update: whatever a previous build in another mode wrote for it is pruned
		if (!conditional.patch) return;

		// The update carries its map inline: it is imported by URL, with no sibling file to resolve
		await fs.writeFile(join(this.#path, patch), conditional.patch.code('sourcemap-inline'));
		this.#written.add(patch);
	}

	/**
	 * Writes the stylesheet of a module and its map. A style module has no code, and this is all it writes.
	 *
	 * @param file The stylesheet, relative to the artifacts directory (`styles()`)
	 */
	async sheet(styles: ConditionalOutput, file: string): Promise<void> {
		const sheet = join(this.#path, file);
		await fs.mkdir(dirname(sheet), { recursive: true });
		const map = styles.map();
		const comment = map ? `\n/*# ${['sourceMappingURL'].join('')}=${posix.basename(file)}.map */\n` : '\n';
		await fs.writeFile(sheet, `${styles.code()}${comment}`);
		this.#written.add(file);
		if (map) {
			await fs.writeFile(`${sheet}.map`, map);
			this.#written.add(`${file}.map`);
		}
	}

	/**
	 * The map of a written artifact: the assembled map names every source by its absolute path, and a file
	 * that travels with its sources names them relative to itself instead, so that an artifacts directory
	 * moved together with the workspace keeps resolving. `file` names the artifact that was written.
	 *
	 * @param map The assembled map, as a JSON string, or undefined for a conditional without one
	 * @param target The absolute path of the artifact file
	 */
	static portable(map: string | undefined, target: string): string | undefined {
		if (!map) return map;

		let parsed: { file?: string; sources?: string[] };
		try {
			parsed = JSON.parse(map);
		} catch {
			return map;
		}
		if (!(parsed.sources instanceof Array)) return map;

		const directory = dirname(target);
		parsed.file = posix.basename(target.split(sep).join(posix.sep));
		parsed.sources = parsed.sources.map(source => {
			if (!isAbsolute(source)) return source;
			const path = relative(directory, source).split(sep).join(posix.sep);
			return path.startsWith('.') ? path : `./${path}`;
		});
		return JSON.stringify(parsed);
	}

	/**
	 * Removes the files of these conditions that this build did not write
	 *
	 * @returns The removed files, relative to the artifacts directory
	 */
	async prune(): Promise<string[]> {
		// Only what `name()` can produce is owned: a versioned package directory and the suffix of the conditions
		const suffix = `\\.${this.#conditions.replace(/\./g, '\\.')}((\\.hmr)?\\.mjs|\\.css|\\.d\\.ts)(\\.map)?$`;
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
