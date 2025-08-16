import type { Package } from '../';
import type { Bundlers } from '../bundlers';
import type { IDiagnostic } from '@beyond-js/packages/types';
import type { ModuleSpec } from './spec';
import { DynamicProcessor } from '@beyond-js/dynamic-processor/main';
import { equal } from '@beyond-js/equal/main';

interface IDone {
	module?: {};
	errors?: IDiagnostic[];
	warnings?: IDiagnostic[];
}

export default class extends DynamicProcessor() {
	get dp() {
		return 'module.resolver';
	}

	#package: Package;
	#bundlers: Bundlers;
	#spec: ModuleSpec;

	#module;
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

	constructor(pkg: Package, bundlers: Bundlers, spec: ModuleSpec) {
		super();

		this.#package = pkg;
		this.#bundlers = bundlers;
		this.#spec = spec;

		super.setup(
			new Map([
				['bundlers', { child: bundlers }],
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

		const bundlers = this.#bundlers;
		if (!bundlers.valid) return done({ errors: bundlers.errors, warnings: bundlers.warnings });

		const spec = this.#spec;

		if (!bundlers.has(spec.bundler)) {
			const code = 'BUNDLER_NOT_FOUND';
			const message = `Bundler "${spec.bundler}" not found`;
			return done({ errors: [{ code, message }] });
		}

		if (this.#module) return done({ module: this.#module });

		const bundler = bundlers.get(spec.bundler);
		const { Bundler } = bundler;

		if (typeof Bundler !== 'function') {
			const code = 'INVALID_MODULE_CLASS';
			const message = `Module package didn't return a Module class`;
			return done({ errors: [{ code, message }] });
		}

		const module = new Bundler({
			package: { name: this.#package.name, version: this.#package.version },
			bundler: { path: bundler.path, settings: bundler.settings, specifier: bundler.specifier },
			spec: this.#spec
		});
		return done({ module });
	}

	destroy() {
		super.destroy();
		this.#module?.destroy();
	}
}
