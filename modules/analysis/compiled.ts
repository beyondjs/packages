import type { IDiagnostic } from '@beyond-js/packages/types';
import type { Compiler, IBundled } from '@beyond-js/packages/bundlers/esbuild/processors/bundle';
import type { Pinned } from './pinned';
import type { Opened, IPublicModule } from './pinned/opened';
import { Target } from './pinned/target';

/**
 * What compiling one public module told a trace: the bundle, which is read and then dropped, and the bundler
 * its package declares for it.
 */
export interface ICompiled {
	bundled?: IBundled;
	composed?: { name: string; specifier: string };
	diagnostics: IDiagnostic[];
}

/**
 * The public modules a trace compiled, each compiled once. A module is visited for its code and, when only
 * its stylesheet is imported, for its stylesheet alone; both visits read the same compilation.
 */
export class Compiled {
	#pinned: Pinned;
	#compiler: Compiler;
	#done: Map<string, Promise<ICompiled>> = new Map();

	/**
	 * How many modules were compiled
	 */
	get count() {
		return this.#done.size;
	}

	constructor(pinned: Pinned, compiler: Compiler) {
		this.#pinned = pinned;
		this.#compiler = compiler;
	}

	get(opened: Opened, module: IPublicModule): Promise<ICompiled> {
		const id = `${opened.key}/${module.subpath}`;
		!this.#done.has(id) && this.#done.set(id, this.#compile(opened, module));
		return this.#done.get(id);
	}

	async #compile(opened: Opened, module: IPublicModule): Promise<ICompiled> {
		const target = new Target(this.#pinned, opened, module);
		const composed = await target.composed();
		const { bundled, diagnostics } = await target.bundle(this.#compiler);
		return { bundled, composed, diagnostics };
	}
}
