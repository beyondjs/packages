import type { Package } from '../';
import type { BaseModule } from '@beyond-js/packages/module';
import type { ModuleSpec } from '@beyond-js/packages/module/spec';
import type { IDiagnostic } from '@beyond-js/packages/types';
import type { RequireType } from '@beyond-js/dynamic-processor/main';
import { DynamicProcessor } from '@beyond-js/dynamic-processor/main';
import { equal } from '@beyond-js/equal/main';

interface IDone {
	module?: BaseModule;
	errors?: IDiagnostic[];
	warnings?: IDiagnostic[];
}

/**
 * Creates the module instance of a specification with the bundler that compiles it.
 *
 * A bundler is an implementation the package registers under a name and Packages imports, so selecting it
 * is asynchronous: the registry knowing the name does not mean its `Module` class is available yet. This
 * resolver waits for the selected bundler before instantiating the module, which is what lets consumers
 * read the modules of a package without ordering the import themselves.
 *
 * A specification that selects no bundler, names one that is not registered, or names one whose
 * implementation could not be imported, produces a diagnostic instead of a module. The module instance is
 * replaced when the specification selects a different bundler, or when the implementation behind the same
 * name changes.
 */
export class ModuleResolver extends DynamicProcessor() {
	get dp() {
		return 'module.resolver';
	}

	#package: Package;
	#spec: ModuleSpec;

	#module: BaseModule;

	/**
	 * The module instance, or undefined while its bundler could not be selected
	 */
	get module() {
		return this.#module;
	}

	/**
	 * The bundler that created the current module instance, kept to detect that the module must be replaced
	 * because its bundler, or the implementation registered for it, is no longer the same
	 */
	#bundler: { name: string; specifier: string; Module: unknown };

	#errors: IDiagnostic[] = [];
	get errors() {
		return this.#errors;
	}

	#warnings: IDiagnostic[] = [];
	get warnings() {
		return this.#warnings;
	}

	get valid() {
		return !this.#errors?.length;
	}

	constructor(pkg: Package, spec: ModuleSpec) {
		super();

		this.#package = pkg;
		this.#spec = spec;

		super.setup(
			new Map([
				['bundlers', { child: pkg.bundlers }],
				['spec', { child: spec }]
			])
		);
	}

	/**
	 * The registry only states which bundlers the package configures. The selected bundler imports its own
	 * implementation, so its readiness is required before the module can be instantiated.
	 */
	_prepared(require: RequireType): void | boolean {
		const { bundlers } = this.#package;
		if (!require(bundlers, 'bundlers')) return false;
		if (!require(this.#spec, 'spec')) return false;

		const name = this.#spec.bundler;
		if (!bundlers.valid || !bundlers.has(name)) return;

		return require(bundlers.get(name), `bundler:${name}`);
	}

	_process() {
		const done = ({ errors, warnings, module }: IDone) => {
			errors = errors ? errors : [];
			warnings = warnings ? warnings : [];

			const previous = { errors: this.#errors, warnings: this.#warnings };
			const changed = !equal({ errors, warnings }, previous) || module !== this.#module;

			this.#errors = errors;
			this.#warnings = warnings;
			this.#module = module;
			return changed;
		};

		const pkg = this.#package;
		const bundlers = pkg.bundlers;
		if (!bundlers.valid) return done({ errors: bundlers.errors, warnings: bundlers.warnings });

		const spec = this.#spec;

		if (!spec.bundler) {
			const code = 'BUNDLER_NOT_SELECTED';
			const message =
				`Module "${spec.subpath}" does not select a bundler. ` +
				`Set "bundler" in its manifest or "beyond.bundler" as the package default bundler`;
			return done({ errors: [{ code, message }] });
		}

		if (!bundlers.has(spec.bundler)) {
			const code = 'BUNDLER_NOT_FOUND';
			const message = `Bundler "${spec.bundler}" of module "${spec.subpath}" is not registered in the package "bundlers"`;
			return done({ errors: [{ code, message }] });
		}

		const bundler = bundlers.get(spec.bundler);
		const { Module } = bundler;

		if (!bundler.valid) {
			const code = 'INVALID_BUNDLER';
			const reported = bundler.errors.map(({ message }) => message).join('; ');
			return done({ errors: [{ code, message: `Bundler "${spec.bundler}" is not valid: ${reported}` }] });
		}

		if (typeof Module !== 'function') {
			const code = 'INVALID_MODULE_CLASS';
			const message = `Bundler "${spec.bundler}" package didn't return a Module class`;
			return done({ errors: [{ code, message }] });
		}

		/**
		 * The module instance is kept while the same implementation compiles it: the specification changing
		 * invalidates the module itself, which is subscribed to it, not the instance it lives in.
		 */
		const current = this.#bundler;
		const same =
			current &&
			current.name === spec.bundler &&
			current.specifier === bundler.specifier &&
			current.Module === Module;
		if (this.#module && same) return done({ module: this.#module });

		this.#module?.destroy();
		this.#bundler = { name: spec.bundler, specifier: bundler.specifier, Module };

		const module = new Module({ package: pkg, spec: this.#spec, bundler });
		return done({ module });
	}

	destroy() {
		super.destroy();
		this.#module?.destroy();
	}
}
