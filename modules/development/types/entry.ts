import { promises as fs } from 'fs';
import { basename, isAbsolute, join, relative } from 'path';
import { Exports } from './exports';
import { Manifest } from './manifest';

/**
 * What a package gives a type check for a subpath: the file it reads, a path it names outside itself (`escape`), or
 * why it gives nothing (`reason`)
 */
export interface IEntry {
	file?: string;
	escape?: string;
	reason?: string;
}

/**
 * The file a type check reads for a subpath of an installed package, found as TypeScript's `bundler` resolution
 * finds it, inside the package only.
 *
 * - With `exports`, the subpath's target under the `types`, `import` and `default` conditions (`Exports`): a
 *   declaration or TypeScript source as named, or the declaration that replaces a JavaScript target (`index.js` is
 *   typed by `index.ts`, `index.tsx` or `index.d.ts`, `.mjs` by `.mts` or `.d.mts`, `.cjs` by `.cts` or `.d.cts`).
 * - Without, for the root: `typings`, else `types`, else `main`, each as a file, with an added extension, or as a
 *   directory with an index; then `index.ts`, `index.tsx` or `index.d.ts`. For another subpath: its file with an
 *   added extension, or its directory, read as the root is.
 *
 * A path the package names outside its directory is not followed: it is reported as `escape`. This object reads
 * only names and metadata; `Confined` reads the file and checks where its real path is.
 */
export class Entry {
	static #TYPED = /\.(d\.[cm]?ts|d\.[^./\\]+\.ts|[cm]?ts|tsx)$/;
	static #KNOWN = /\.(d\.[cm]?ts|[cm]?tsx?|[cm]?jsx?|json)$/;
	static #ADDED: Record<string, string[]> = {
		'.mjs': ['.mts', '.d.mts'],
		'.mts': ['.mts', '.d.mts'],
		'.d.mts': ['.mts', '.d.mts'],
		'.cjs': ['.cts', '.d.cts'],
		'.cts': ['.cts', '.d.cts'],
		'.d.cts': ['.cts', '.d.cts'],
		'.tsx': ['.tsx', '.ts', '.d.ts'],
		'.jsx': ['.tsx', '.ts', '.d.ts'],
		'.json': ['.d.json.ts'],
		'.ts': ['.ts', '.tsx', '.d.ts'],
		'.d.ts': ['.ts', '.tsx', '.d.ts'],
		'.js': ['.ts', '.tsx', '.d.ts'],
		'': ['.ts', '.tsx', '.d.ts']
	};

	#manifest: Manifest;
	#root: string;

	/**
	 * @param manifest The manifest of the package, read from its real directory
	 */
	constructor(manifest: Manifest) {
		this.#manifest = manifest;
		this.#root = manifest.directory;
	}

	/**
	 * Whether a file is a declaration (`.d.ts`, `.d.mts`, `.d.cts`, `.d.<extension>.ts`) rather than a TypeScript source
	 */
	static declaration(file: string): boolean {
		return /\.d\.([cm]?ts|[^./\\]+\.ts)$/.test(file);
	}

	/**
	 * @param subpath `.` or `./name`
	 */
	async resolve(subpath: string): Promise<IEntry> {
		const values = this.#manifest.values;
		const exports = new Exports(values.exports);
		if (exports.declared) return this.#exported(exports, subpath);

		if (subpath === '.') {
			const found = await this.#directory(this.#root, values);
			return found ?? { reason: 'it declares no types, typings or main that names a declaration, and has no index.d.ts' };
		}
		const candidate = join(this.#root, subpath);
		const file = await this.#file(candidate);
		if (file) return { file };
		const found = await this.#directory(candidate, await Manifest.json(join(candidate, 'package.json')));
		return found ?? { reason: `it has no declaration for "${subpath}"` };
	}

	async #exported(exports: Exports, subpath: string): Promise<IEntry> {
		const matched = exports.match(subpath);
		if (!matched) return { reason: `its exports do not export "${subpath}"` };
		for (const step of exports.steps(matched)) {
			if (step.stop === 'escape') return { escape: step.value };
			if (step.stop === 'excluded') return { reason: `its exports exclude "${subpath}"` };
			if (step.stop) return { reason: `its exports name an invalid target for "${subpath}" (${step.value})` };
			const file = await this.#field(join(this.#root, step.target));
			if (file) return { file };
		}
		return { reason: `none of the targets its exports give "${subpath}" under the types, import or default conditions is a declaration or TypeScript source that exists` };
	}

	/**
	 * Whether a path is inside the package
	 */
	#inside(path: string): boolean {
		const named = relative(this.#root, path);
		return !named.startsWith('..') && !isAbsolute(named);
	}

	async #exists(file: string): Promise<boolean> {
		return fs.stat(file).then(found => found.isFile(), () => false);
	}

	/**
	 * A file a manifest field names: as it is when it is typed, else by replacing its extension
	 */
	async #field(candidate: string): Promise<string | undefined> {
		if (Entry.#TYPED.test(candidate)) return (await this.#exists(candidate)) ? candidate : void 0;
		return this.#replaced(candidate);
	}

	/**
	 * The typed file that stands for a file with another extension; nothing for a name without one
	 */
	async #replaced(candidate: string): Promise<string | undefined> {
		if (!basename(candidate).includes('.')) return;
		let extensionless = candidate.replace(Entry.#KNOWN, '');
		if (extensionless === candidate) extensionless = candidate.slice(0, candidate.lastIndexOf('.'));
		return this.#added(extensionless, candidate.slice(extensionless.length));
	}

	async #added(base: string, extension: string): Promise<string | undefined> {
		const extensions = Entry.#ADDED[extension] ?? [`.d${extension}.ts`];
		for (const one of extensions) if (await this.#exists(base + one)) return base + one;
	}

	/**
	 * A file a module specifier names: by replacing its extension, then by adding one
	 */
	async #file(candidate: string): Promise<string | undefined> {
		return (await this.#replaced(candidate)) ?? (await this.#added(candidate, ''));
	}

	/**
	 * A directory as a package: the field its manifest types it with, then its index
	 */
	async #directory(candidate: string, values: Record<string, any> | undefined): Promise<IEntry | undefined> {
		const named = [values?.typings, values?.types, values?.main].find(value => typeof value === 'string' && value);
		if (named) {
			const file = join(candidate, named);
			if (!this.#inside(file)) return { escape: named };
			const found = (await this.#field(file)) ?? (await this.#file(file)) ?? (await this.#added(join(file, 'index'), ''));
			if (found) return { file: found };
		}
		const index = await this.#added(join(candidate, 'index'), '');
		return index ? { file: index } : void 0;
	}
}
