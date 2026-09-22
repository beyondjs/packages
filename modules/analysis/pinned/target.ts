import type { IDiagnostic } from '@beyond-js/packages/types';
import { Bundle, type Compiler, type IBundled } from '@beyond-js/packages/bundlers/esbuild/processors/bundle';
import { Keyed } from '../keyed';
import type { Pinned } from './';
import type { Opened, IPublicModule } from './opened';
import { Composition } from './composition';
import { SourcePackage } from './source';

/**
 * One public module of the pinned inputs, as the unit that produces it runs on.
 *
 * Tracing and generation compile a module through this object, so both see the same entry point, the same
 * boundary and the same references: what an inventory lists is what a generation produces. Which one
 * produces it is the package's declaration: a module composed by a bundler of its package is compiled by
 * that bundler, and every other module by the compiler the consumer selected.
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
	 * The bundler the package declares for this module, when the module is composed by one of its own
	 */
	async composed(): Promise<{ name: string; specifier: string } | undefined> {
		const opened = this.#opened;
		return opened instanceof SourcePackage ? await opened.composed(Keyed.declared(this.#module.subpath)) : void 0;
	}

	/**
	 * @param minify Whether the output is minified, which tracing never needs
	 */
	async bundle(compiler: Compiler, minify = false): Promise<{ bundled?: IBundled; diagnostics: IDiagnostic[] }> {
		const { conditions } = this.#pinned;

		// A module composed by a bundler of its package is compiled by that bundler, whatever the consumer selected
		if (await this.composed()) {
			const pkg = await (<SourcePackage>this.#opened).read();
			return await new Composition(pkg, Keyed.declared(this.#module.subpath), conditions).run();
		}

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
