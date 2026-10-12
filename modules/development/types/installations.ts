import type { IServedNode } from '../builds';
import { promises as fs } from 'fs';
import { basename, dirname, join } from 'path';

/**
 * A package where a type check would read the declaration of a name: its real directory, whether it is the package
 * itself or its `@types` package, and who provides it
 */
export interface ICandidate {
	name: string;
	root: string;
	provenance: 'package' | 'types-package';
	provider: 'installation' | 'toolchain' | 'store';
	node?: IServedNode;
}

/**
 * Where a package and its `@types` package are installed for a directory of a workspace without an installed graph,
 * looked for as a type check looks for them: `node_modules/<name>`, then `node_modules/@types/<name>` (a scoped
 * `@scope/name` as `@types/scope__name`), in the directory and in each of its ancestors, never inside a directory
 * named `node_modules`. When nothing of the name is installed there, the installation that runs Packages
 * (`toolchain`) is searched the same way, as the type check of such a workspace falls back to it; a package found
 * for the importer that declares no types is not completed from the toolchain.
 */
export class Installations {
	#toolchain: string;

	/**
	 * @param toolchain The directory of the installation that runs Packages, the type check's fallback
	 */
	constructor(toolchain: string = process.cwd()) {
		this.#toolchain = toolchain;
	}

	/**
	 * The name of the `@types` package of a package, undefined for an `@types` package itself
	 */
	static types(name: string): string | undefined {
		if (name.startsWith('@types/')) return;
		return `@types/${name.replace(/^@([^/]+)\//, '$1__')}`;
	}

	/**
	 * The `node_modules` directories searched from a directory, nearest first
	 */
	static *#levels(from: string): Generator<string> {
		for (let directory = from; ; directory = dirname(directory)) {
			if (basename(directory) !== 'node_modules') yield join(directory, 'node_modules');
			if (dirname(directory) === directory) return;
		}
	}

	/**
	 * The real directory of a package installed at a location, undefined when none is there
	 */
	static async #installed(location: string): Promise<string | undefined> {
		const manifest = await fs.stat(join(location, 'package.json')).then(found => found.isFile(), () => false);
		return manifest ? fs.realpath(location).catch((): undefined => void 0) : void 0;
	}

	async #search(name: string, from: string, provider: 'installation' | 'toolchain'): Promise<ICandidate[]> {
		const types = Installations.types(name);
		const found: ICandidate[] = [];
		for (const level of Installations.#levels(from)) {
			const own = await Installations.#installed(join(level, ...name.split('/')));
			own && found.push({ name, root: own, provenance: name.startsWith('@types/') ? 'types-package' : 'package', provider });
			const typed = types && (await Installations.#installed(join(level, ...types.split('/'))));
			typed && found.push({ name: types, root: typed, provenance: 'types-package', provider });
		}
		return found;
	}

	/**
	 * Every package a type check would try for a name, in its order: what is installed for the directory, else what
	 * the toolchain installs
	 *
	 * @param from The directory of the importer
	 */
	async candidates(name: string, from: string): Promise<ICandidate[]> {
		const found = await this.#search(name, from, 'installation');
		return found.length ? found : this.#search(name, this.#toolchain, 'toolchain');
	}

	/**
	 * The package itself (never its `@types` package) a name is installed as for a directory, the nearest one
	 */
	async locate(name: string, from: string): Promise<ICandidate | undefined> {
		return (await this.candidates(name, from)).find(candidate => candidate.name === name);
	}
}
