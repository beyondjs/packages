import type { IDiagnostic } from '@beyond-js/packages/types';
import { Bundle, type Compiler, type IBundled } from '@beyond-js/packages/bundlers/esbuild/processors/bundle';
import type { Pinned } from './';
import type { Opened, IPublicModule } from './opened';

/**
 * One public module of the pinned inputs, as the unit the compiler runs on.
 *
 * Tracing and generation compile a module through this object, so both see the same entry point, the same
 * boundary and the same references: what an inventory lists is what a generation produces.
 */
export /*bundle*/ class Target {
	#pinned: Pinned;
	#opened: Opened;
	#module: IPublicModule;

	constructor(pinned: Pinned, opened: Opened, module: IPublicModule) {
		this.#pinned = pinned;
		this.#opened = opened;
		this.#module = module;
	}

	/**
	 * @param minify Whether the output is minified, which tracing never needs
	 */
	async bundle(compiler: Compiler, minify = false): Promise<{ bundled?: IBundled; diagnostics: IDiagnostic[] }> {
		const { conditions } = this.#pinned;
		const { entry, directory, facade, subpath, mode } = this.#module;
		if (!entry) return { diagnostics: [{ code: 'MODULE_NOT_COMPILABLE', message: `"${subpath}" of "${this.#opened.key}" is distributed, not compiled` }] };

		const styles = async (specifier: string) => (await this.#pinned.land(this.#opened.key, specifier)).module?.kind === 'style';
		return await new Bundle(compiler, {
			root: directory,
			entry,
			facade,
			entries: await this.#opened.entries(conditions, subpath),
			package: { root: this.#opened.root, subpath },
			platform: conditions.platform,
			environment: conditions.environment,
			conditions: this.#module.conditions,
			mode,
			minify,
			styles
		}).run();
	}
}
