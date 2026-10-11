import { Confinement } from '@beyond-js/packages/confinement';
import * as ts from 'typescript';
import { existsSync, readFileSync, statSync } from 'fs';
import { dirname, isAbsolute, join, resolve } from 'path';

/**
 * The TypeScript configuration a confined build compiles a module with.
 *
 * Left to itself, the compiler looks for `tsconfig.json` and `jsconfig.json` from every source up to the root
 * of the file system and reads whatever their `extends` names, reporting the first token of a file that is
 * not JSON: a package could make it read, and disclose, a file of the machine. A confined build is given this
 * configuration instead (`tsconfigRaw`), so the compiler looks for none: the one nearest to the module inside
 * its package, with the bases it extends that are inside the package too. A base outside the package, or one
 * that a bare name would find in no installation of the package itself, is not read, exactly as a base that
 * does not exist is not.
 *
 * One configuration applies to the whole module: a `tsconfig.json` of a subdirectory of the module, which the
 * compiler would apply to the sources under it, is not.
 */
export class TSConfig {
	static FILES = ['tsconfig.json', 'jsconfig.json'];

	#root: string;
	#confinement: Confinement;

	/**
	 * @param root The root of the package
	 */
	constructor(root: string) {
		this.#root = root;
		this.#confinement = new Confinement([root]);
	}

	/**
	 * The configuration of a module as the compiler takes it
	 *
	 * @param directory The module directory, where the search starts
	 */
	raw(directory: string): string {
		const file = this.#nearest(directory);
		return JSON.stringify({ compilerOptions: file ? this.#options(file, new Set()) : {} });
	}

	#file(path: string): boolean {
		return existsSync(path) && statSync(path).isFile();
	}

	#nearest(directory: string): string | undefined {
		for (let current = directory; this.#confinement.contains(current); current = dirname(current)) {
			const found = TSConfig.FILES.map(name => join(current, name)).find(file => this.#file(file));
			if (found) return this.#confinement.inside(found) ? found : void 0;
			if (dirname(current) === current) return;
		}
	}

	/**
	 * The compiler options of a configuration, over the ones of the bases it extends, in order
	 */
	#options(file: string, visited: Set<string>): Record<string, unknown> {
		if (visited.has(file)) return {};
		visited.add(file);

		const { config } = ts.parseConfigFileTextToJson(file, readFileSync(file, 'utf8'));
		if (!config || typeof config !== 'object') return {};

		const merged: Record<string, unknown> = {};
		const bases: unknown[] = [].concat(config.extends ?? []);
		for (const base of bases) {
			const found = typeof base === 'string' ? this.#base(base, dirname(file)) : void 0;
			found && Object.assign(merged, this.#options(found, visited));
		}
		const own = config.compilerOptions;
		return Object.assign(merged, own && typeof own === 'object' ? own : {});
	}

	/**
	 * The file a base names, when it is inside the package: a path from the configuration that names it, or a
	 * bare name found in a `node_modules` directory of the package
	 */
	#base(name: string, from: string): string | undefined {
		const located = name.startsWith('.') || isAbsolute(name);
		const directories: string[] = [];
		for (let current = from; !located && this.#confinement.contains(current); current = dirname(current)) {
			directories.push(join(current, 'node_modules'));
			if (current === this.#root || dirname(current) === current) break;
		}

		const paths = located ? [resolve(from, name)] : directories.map(directory => join(directory, name));
		const candidates = paths.flatMap(path => [path, `${path}.json`, join(path, 'tsconfig.json')]);
		const found = candidates.find(candidate => this.#confinement.contains(candidate) && this.#file(candidate));
		return found && this.#confinement.inside(found) ? found : void 0;
	}
}
