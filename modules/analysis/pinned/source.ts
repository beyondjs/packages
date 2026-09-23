import type { IDiagnostic } from '@beyond-js/packages/types';
import { Package } from '@beyond-js/packages/package';
import { existsSync, realpathSync } from 'fs';
import { join, posix } from 'path';
import type { IAnalysisConditions } from '../types';
import { Opened, type IPublicModule } from './opened';
import { Composition } from './composition';
import { Specifier } from '../specifier';

/**
 * A package published as Beyond sources.
 *
 * Its public modules are the ones its `exports` entries and module manifests declare, read with the same
 * declarations a workspace package is read with. A module manifest adds `platforms`, the `assets` the
 * module declares (paths relative to the module directory) and `dynamic`, the public modules its
 * indeterminate dynamic imports may load.
 *
 * A module that selects a bundler of the package is compiled by that bundler, which is what the package
 * declared it is compiled with: its processors, its composition and its runtime are part of the package's
 * contract and not of the consumer's choice of compiler. A module that selects none, or the packaging
 * bundler, is compiled by the compiler the consumer selects.
 */
export /*bundle*/ class SourcePackage extends Opened {
	#pkg: Package;

	/**
	 * The package as Packages reads it, which is what its own bundler compiles from
	 */
	async read(): Promise<Package> {
		await this.#specs();
		return this.#pkg;
	}

	/**
	 * The bundler this package declares for one of its public modules, when it declares one
	 */
	async composed(subpath: string) {
		return Composition.declared(await this.read(), subpath);
	}

	/**
	 * The package is read from the real location of its root, which is how every other location of this
	 * preparation is compared, and with the identity of its node: what its processors derive the identifiers
	 * of its components from, so two sources of one name and version never share them and one source yields
	 * the same ones wherever it was extracted.
	 */
	async #specs() {
		const identity = JSON.stringify([this.key, this.integrity ?? null]);
		this.#pkg = this.#pkg ?? new Package(realpathSync(this.root), { identity });
		await this.#pkg.ready;
		await this.#pkg.modules.ready;
		return this.#pkg.modules;
	}

	async module(subpath: string, conditions: IAnalysisConditions) {
		const diagnostics: IDiagnostic[] = [];
		const fail = (code: string, message: string) => (diagnostics.push({ code, message }), { diagnostics });

		const modules = await this.#specs();
		const spec = modules.specs.get(subpath);
		const label = Specifier.of(this.name, subpath);
		if (!spec) {
			const reasons = this.#pkg.errors.concat(modules.errors).map(({ message }) => message);
			return fail('MODULE_NOT_FOUND', `Package "${this.key}" does not publish "${label}"${reasons.length ? `: ${reasons.join('; ')}` : ''}`);
		}

		const values = <Record<string, any>>spec.values;

		/**
		 * A module composed by a bundler of its package has no entry point here: which source starts it, and
		 * which sources the requested conditions exclude, is what that bundler decides from the manifest. A
		 * module compiled by the selected compiler is entered at the one file its manifest names.
		 */
		const composed = Composition.declared(this.#pkg, subpath);
		if (!composed && !spec.entry) return fail('MODULE_ENTRY_MISSING', `Module "${label}" does not define its entry point`);

		const platforms: string[] = [].concat(values.platforms ?? []).map(platform => (platform === 'web' ? 'browser' : platform));
		if (platforms.length && !platforms.includes(conditions.platform) && !platforms.includes('default')) {
			return fail('PLATFORM_UNSUPPORTED', `Module "${label}" is declared for ${platforms.join(', ')}, not for "${conditions.platform}"`);
		}

		const directory = join(this.root, spec.path ?? '');
		const entry = spec.entry && join(directory, spec.entry);
		if (entry && !existsSync(entry)) {
			return fail('MODULE_ENTRY_MISSING', `The entry point of "${label}" does not exist: ${posix.join(spec.path ?? '', spec.entry)}`);
		}

		const list = (value: unknown): string[] => (value instanceof Array ? value.filter(one => typeof one === 'string') : []);
		const module: IPublicModule = {
			subpath,
			kind: values.kind === 'style' ? 'style' : 'module',
			entry: entry ? realpathSync(entry) : void 0,
			directory: realpathSync(directory),
			assets: list(values.assets).map(path => posix.normalize(posix.join(spec.path ?? '', path))),
			dynamic: list(values.dynamic)
		};
		return { module, diagnostics };
	}

	async entries(conditions: IAnalysisConditions, except: string): Promise<Map<string, string>> {
		void conditions;
		const entries: Map<string, string> = new Map();
		(await this.#specs()).specs.forEach((spec, subpath) => {
			const file = spec.entry && join(this.root, spec.path ?? '', spec.entry);
			subpath !== except && file && existsSync(file) && entries.set(realpathSync(file), Specifier.of(this.name, subpath));
		});
		return entries;
	}

	destroy(): void {
		this.#pkg?.destroy();
	}
}
