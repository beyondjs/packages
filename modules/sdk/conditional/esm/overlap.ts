import type { IDiagnostic } from '@beyond-js/packages/types';
import { posix } from 'path';

/**
 * What the overlap needs of a public module: its subpath, the directory of its sources relative to its package
 * and its specification values
 */
export interface IOverlapped {
	spec: { subpath?: string; path?: string; entry?: string; values?: unknown };
	package: { vname?: string; modules?: Map<string, IOverlapped> };
}

/**
 * The other public modules of the package whose sources lie in the directory of a module.
 *
 * The inputs of a module are the files of its directory and its subdirectories, unless its manifest names its
 * `files`. Two public modules declared through `exports` with entry points in one directory (`./main/index.ts` and
 * `./main/math.ts`), or one whose entry lies under the directory of another, therefore compile each other's sources:
 * each artifact holds and evaluates the other's top-level code. Such a module is reported with
 * `MODULES_SHARE_DIRECTORY` and its artifact is made of the sources its entry imports (`Reach`).
 *
 * A module that names its `files`, and a style module (whose input is its stylesheet alone), compiles nothing it was
 * not given, so it shares no directory.
 */
export class Overlap {
	static CODE = 'MODULES_SHARE_DIRECTORY';

	#module: IOverlapped;

	constructor(module: IOverlapped) {
		this.#module = module;
	}

	static #restricted(module: IOverlapped): boolean {
		const values = <{ files?: unknown; kind?: unknown }>module.spec.values;
		return values?.files !== undefined || values?.kind === 'style';
	}

	static #directory(module: IOverlapped): string {
		return posix.normalize(module.spec.path ?? '').replace(/^\.\/?$/, '').replace(/\/$/, '');
	}

	static #inside(directory: string, path: string): boolean {
		return !directory || path === directory || path.startsWith(`${directory}/`);
	}

	/**
	 * The subpaths of the other modules whose entry points lie in the directory of this one
	 */
	get modules(): string[] {
		const module = this.#module;
		if (Overlap.#restricted(module)) return [];

		const directory = Overlap.#directory(module);
		const shared: string[] = [];
		module.package.modules?.forEach((other, subpath) => {
			if (other === module || Overlap.#restricted(other) || typeof other.spec.entry !== 'string') return;
			Overlap.#inside(directory, Overlap.#directory(other)) && shared.push(subpath);
		});
		return shared.sort();
	}

	/**
	 * The warning of a module that shares its directory, or undefined
	 */
	get warning(): IDiagnostic | undefined {
		const shared = this.modules;
		if (!shared.length) return;

		const { spec } = this.#module;
		const directory = Overlap.#directory(this.#module) || '.';
		const others = shared.map(subpath => `"${subpath}"`).join(', ');
		const message =
			`Public module "${spec.subpath}" shares its directory "${directory}" with ${others}: ` +
			`only the files its entry point imports are compiled into it. Give each public module a directory of its own.`;
		return { code: Overlap.CODE, message };
	}
}
