import { promises as fs } from 'fs';
import { join, posix } from 'path';

/**
 * The `package.json` of a package, read within a bound, as type browsing needs it: its identity, the fields a type
 * check resolves declarations from, and what says how its public modules are compiled.
 */
export class Manifest {
	/**
	 * The largest manifest that is read
	 */
	static LIMIT = 1024 * 1024;

	#directory: string;
	#values: Record<string, any>;

	/**
	 * The directory of the package
	 */
	get directory() {
		return this.#directory;
	}

	get values(): Record<string, any> {
		return this.#values;
	}

	get name(): string | undefined {
		return typeof this.#values.name === 'string' ? this.#values.name : void 0;
	}

	get version(): string | undefined {
		return typeof this.#values.version === 'string' ? this.#values.version : void 0;
	}

	constructor(directory: string, values: Record<string, any>) {
		this.#directory = directory;
		this.#values = values;
	}

	/**
	 * The manifest of a directory, undefined when it has none that can be read as a JSON object
	 */
	static async read(directory: string): Promise<Manifest | undefined> {
		const values = await Manifest.json(join(directory, 'package.json'));
		return values && new Manifest(directory, values);
	}

	/**
	 * A JSON object in a file, within the bound; undefined for anything else
	 */
	static async json(file: string): Promise<Record<string, any> | undefined> {
		try {
			const { size } = await fs.stat(file);
			if (size > Manifest.LIMIT) return;
			const value = JSON.parse(await fs.readFile(file, 'utf8'));
			return value && typeof value === 'object' && !Array.isArray(value) ? value : void 0;
		} catch {
			return;
		}
	}

	/**
	 * The `exports` target of a subpath when it is a literal string, as Beyond's packages declare their modules
	 */
	target(subpath: string): string | undefined {
		const { exports } = this.#values;
		const target = typeof exports === 'string' && subpath === '.' ? exports : exports?.[subpath];
		return typeof target === 'string' ? target : void 0;
	}

	/**
	 * Whether a public module is a style module: its `exports` target is a stylesheet, which has no declaration
	 */
	style(subpath: string): boolean {
		const target = this.target(subpath);
		return !!target && target.startsWith('./') && /\.(css|scss|sass)$/.test(target);
	}

	/**
	 * The bundler a module of the package selects, as far as its manifests say: the `bundler` of the `module.json` in
	 * the directory of its entry point, else the default bundler of the package (`beyond.bundler`), with the specifier
	 * the package registers it under
	 */
	async bundler(subpath: string): Promise<{ name: string; specifier?: string } | undefined> {
		const target = this.target(subpath);
		const directory = target?.startsWith('./') ? posix.dirname(posix.normalize(target)) : void 0;
		const module = directory && !directory.startsWith('..') ? await Manifest.json(join(this.#directory, directory, 'module.json')) : void 0;
		const selected = module?.bundler ?? module?.bundle ?? this.#values.beyond?.bundler;
		if (typeof selected !== 'string' || !selected) return;

		const specifier = this.#values.bundlers?.[selected]?.specifier;
		return { name: selected, ...(typeof specifier === 'string' ? { specifier } : {}) };
	}
}
