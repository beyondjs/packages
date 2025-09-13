import type { Package } from '../';
import type { BaseModule } from '@beyond-js/packages/module';
import type { ModuleSpec } from '@beyond-js/packages/module/spec';
import type { IDiagnostic } from '@beyond-js/packages/types';
import { DynamicProcessor } from '@beyond-js/dynamic-processor/main';
import { equal } from '@beyond-js/equal/main';

interface IDone {
	module?: BaseModule;
	errors?: IDiagnostic[];
	warnings?: IDiagnostic[];
}

export class ModuleResolver extends DynamicProcessor() {
	get dp() {
		return 'module.resolver';
	}

	#package: Package;
	#spec: ModuleSpec;

	#module: BaseModule;
	get module() {
		return this.#module;
	}

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

	_process() {
		const done = ({ errors, warnings, module }: IDone) => {
			this.#errors = errors ? errors : [];
			this.#warnings = warnings ? warnings : [];
			const previous = { errors: this.#errors, warnings: this.#warnings, module: !!this.#module };
			const changed = equal({ errors, warnings, module: !!module }, previous);

			this.#module = module;
			return changed;
		};

		const pkg = this.#package;
		const bundlers = pkg.bundlers;
		if (!bundlers.valid) return done({ errors: bundlers.errors, warnings: bundlers.warnings });

		const spec = this.#spec;

		if (!bundlers.has(spec.bundler)) {
			const code = 'BUNDLER_NOT_FOUND';
			const message = `Bundler "${spec.bundler}" not found`;
			return done({ errors: [{ code, message }] });
		}

		if (this.#module) return done({ module: this.#module });

		const bundler = bundlers.get(spec.bundler);
		const { Module } = bundler;

		if (!bundler.valid) {
			const code = 'INVALID_BUNDLER';
			const message = `Bundler "${spec.bundler}" is not valid`;
			return done({ errors: [{ code, message }] });
		}

		if (typeof Module !== 'function') {
			const code = 'INVALID_MODULE_CLASS';
			const message = `Bundler "${spec.bundler}" package didn't return a Module class`;
			return done({ errors: [{ code, message }] });
		}

		const module = new Module({
			package: pkg,
			spec: this.#spec,
			bundler
		});
		return done({ module });
	}

	destroy() {
		super.destroy();
		this.#module?.destroy();
	}
}
