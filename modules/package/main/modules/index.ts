import type { Package } from '../';
import type { RequireType } from '@beyond-js/dynamic-processor/main';
import type { IDiagnostic } from '@beyond-js/packages/types';
import type { BaseModule } from '@beyond-js/packages/module';
import { DynamicProcessor } from '@beyond-js/dynamic-processor/main';
import { Config } from '@beyond-js/config/main';
import { equal } from '@beyond-js/equal/main';
import { ModuleSpec } from '@beyond-js/packages/module/spec';
import { Declarations } from './declarations';
import { ModuleExports } from './exports';
import { ModuleManifests } from './manifests';
import { ModuleResolver } from './resolver';

interface IPreparedDone {
	updated: Map<string, ModuleResolver>;
	errors?: IDiagnostic[];
	warnings?: IDiagnostic[];
}

interface IProcessDone {
	warnings?: IDiagnostic[];
	updated: Map<string, BaseModule>;
}

/**
 * The public modules of a package.
 *
 * How a package declares them is resolved by the [declarations](./declarations.ts), which combine its
 * exports entries with its module manifests. This collection owns the resulting specifications and the
 * resolvers that instantiate each module with the bundler that compiles it. A module that cannot be
 * resolved is reported as a warning and left out, so the rest of the package still compiles.
 */
export class Modules extends DynamicProcessor(Map<string, BaseModule>) {
	get dp() {
		return 'package.modules';
	}

	#package: Package;
	#exports: ModuleExports;
	#manifests: ModuleManifests;

	/**
	 * The specification of each declared module, owned by this collection because it combines declarations
	 * that come from different sources
	 */
	#specs: Map<string, ModuleSpec> = new Map();

	#resolvers: Map<string, ModuleResolver> = new Map();

	/**
	 * The diagnostics of the declarations: contradictions that prevent a module from being declared
	 */
	#errors: IDiagnostic[] = [];
	get errors() {
		return this.#errors;
	}

	#warnings: IDiagnostic[] = [];

	/**
	 * The diagnostics of the modules that could not be resolved, which are separate from the declaration
	 * ones because they are produced in a later phase
	 */
	#unresolved: IDiagnostic[] = [];

	get warnings() {
		return this.#warnings.concat(this.#unresolved);
	}

	get valid() {
		return !this.#errors.length;
	}

	constructor(pkg: Package, config: Config) {
		super();

		this.#package = pkg;
		this.#exports = new ModuleExports(config);
		this.#manifests = new ModuleManifests(config);
	}

	/**
	 * Declares the modules of the package and requires their resolvers, whose results are read once every
	 * one of them has selected and awaited its bundler
	 */
	_prepared(require: RequireType): void | boolean {
		if (!require(this.#package, 'package')) return false;
		if (!require(this.#exports, 'package-exports')) return false;
		if (!require(this.#manifests, 'package-manifests')) return false;

		let ready = true;
		this.#manifests.forEach(manifest => {
			const id = `manifest-modules:${manifest.file.relative.file}`;
			ready = ready && require(manifest.modules, id);
		});
		if (!ready) return false;

		const done = ({ updated, errors, warnings }: IPreparedDone) => {
			this.#errors = errors ? errors : [];
			this.#warnings = warnings ? warnings : [];

			// Release the resolvers and specifications of the modules that are no longer declared
			this.#resolvers.forEach((resolver, subpath) => !updated.has(subpath) && resolver.destroy());
			this.#specs.forEach((spec, subpath) => {
				if (updated.has(subpath)) return;
				spec.destroy();
				this.#specs.delete(subpath);
			});

			this.#resolvers.clear();
			updated.forEach((resolver, subpath) => this.#resolvers.set(subpath, resolver));

			// The modules are read only once every resolver has selected its bundler and instantiated it
			this.#resolvers.forEach((resolver, subpath) => require(resolver, `module-resolver:${subpath}`));
		};

		const declarations = new Declarations(this.#exports, this.#manifests, this.#package.defaultBundler);
		const updated = new Map<string, ModuleResolver>();

		declarations.forEach((declaration, subpath) => {
			const { bundler, path, values, sources } = declaration;

			const spec = (() => {
				if (this.#specs.has(subpath)) return this.#specs.get(subpath);

				const info = sources.includes('exports')
					? { type: <const>'export', subpath }
					: { type: <const>'manifest', path };
				const spec = new ModuleSpec(info, bundler);
				this.#specs.set(subpath, spec);
				return spec;
			})();
			spec.update(Object.assign({ subpath }, values), { bundler, path });

			const resolver = this.#resolvers.has(subpath)
				? this.#resolvers.get(subpath)
				: new ModuleResolver(this.#package, spec);
			updated.set(subpath, resolver);
		});

		return done({ updated, errors: declarations.errors, warnings: declarations.warnings });
	}

	_process() {
		const done = ({ updated, warnings }: IProcessDone) => {
			warnings = warnings ? warnings : [];

			// A module instance replaced by its resolver, because its bundler changed, is also a change
			const previous = { modules: [...this.keys()], warnings: this.#unresolved };
			const changed =
				!equal(previous, { modules: [...updated.keys()], warnings }) ||
				[...updated].some(([subpath, module]) => this.get(subpath) !== module);

			this.#unresolved = warnings;
			this.clear();
			updated.forEach((module, subpath) => this.set(subpath, module));

			return changed;
		};

		const warnings: IDiagnostic[] = [];
		const updated = new Map<string, BaseModule>();

		this.#resolvers.forEach((resolver, subpath) => {
			if (!resolver.valid) {
				const code = 'INVALID_RESOLVER';
				const reported = resolver.errors.map(({ message }) => message).join('; ');
				warnings.push({ code, message: `Module "${subpath}" cannot be resolved: ${reported}` });
				return;
			}

			updated.set(subpath, resolver.module);
		});

		return done({ warnings, updated });
	}

	/**
	 * The resolver of a module subpath, which exposes why a declared module is missing from the collection
	 */
	resolver(subpath: string): ModuleResolver | undefined {
		return this.#resolvers.get(subpath);
	}

	destroy() {
		super.destroy();
		this.#resolvers.forEach(resolver => resolver.destroy());
		this.#specs.forEach(spec => spec.destroy());
		this.#exports.destroy();
		this.#manifests.destroy();
	}
}
