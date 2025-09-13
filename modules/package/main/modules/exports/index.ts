import type { RequireType } from '@beyond-js/dynamic-processor/main';
import type { IDiagnostic } from '@beyond-js/packages/types';
import type { ExportsType } from '@beyond-js/packages/types';
import type { IExportInfo } from '@beyond-js/packages/module/spec';
import { DynamicProcessor } from '@beyond-js/dynamic-processor/main';
import { Config } from '@beyond-js/config/main';
import { ModuleSpec } from '@beyond-js/packages/module/spec';
import { equal } from '@beyond-js/equal/main';

interface IDone {
	updated?: Map<string, ExportsType>;
	errors?: IDiagnostic[];
	warnings?: IDiagnostic[];
}

export class ModuleExports extends DynamicProcessor(Map<string, ModuleSpec>) {
	get dp() {
		return 'package.modules.exports';
	}

	#config: Config;

	#errors: IDiagnostic[] = [];
	get errors() {
		return this.#errors;
	}

	#warnings: IDiagnostic[] = [];
	get warnings() {
		return this.#warnings;
	}

	get valid() {
		return !this.#errors.length;
	}

	constructor(config: Config) {
		super();
		this.#config = config;
	}

	_prepared(require: RequireType): void {
		require(this.#config, 'package-config');

		const exports = this.#config.get('exports');
		require(exports, 'package-config-exports');
	}

	_process() {
		const done = ({ errors, warnings, updated }: IDone) => {
			errors = errors ? errors : [];
			warnings = warnings ? warnings : [];
			updated = updated ? updated : new Map();

			const previous = { errors: this.#errors, warnings: this.#warnings, entries: [...this.keys()] };
			const changed = !equal(previous, { errors, warnings, entries: updated });

			// Destroy unused modules spec
			this.forEach((module, bundler) => {
				if (updated?.has(bundler)) return;
				module.destroy();
				this.delete(bundler);
			});

			// Update the errors and warnings
			this.#errors = errors;
			this.#warnings = warnings;

			// Update the modules
			updated?.forEach((spec, subpath) => {
				const info: IExportInfo = { type: 'export', subpath };
				const module = this.has(subpath) ? this.get(subpath) : new ModuleSpec(info, 'exports');
				module.update(spec);
				this.set(subpath, module);
			});

			// Even if there are no changes of the keys of the modules, it is required to update their values,
			// so don't move it before updating the modules
			return changed;
		};

		const exports = this.#config.get('exports');
		if (!exports.valid) return done({ errors: exports.errors, warnings: exports.warnings });

		const updated = exports.value ? new Map(Object.entries(exports.value)) : new Map();
		return done({ updated, warnings: exports.warnings });
	}
}
