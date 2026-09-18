import type { RequireType } from '@beyond-js/dynamic-processor/main';
import type { IDiagnostic } from '@beyond-js/packages/types';
import type { ExportsType } from '@beyond-js/packages/types';
import type { IExportInfo } from '@beyond-js/packages/module/spec';
import { DynamicProcessor } from '@beyond-js/dynamic-processor/main';
import { Config } from '@beyond-js/config/main';
import { ModuleSpec } from '@beyond-js/packages/module/spec';
import { equal } from '@beyond-js/equal/main';
import { Entries } from './entries';

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

		/**
		 * The fields are read from the manifest as written. They are not configuration branches: a branch
		 * whose value is a string names a file to load, and both the `exports` shorthand and `main` are
		 * strings that name a source file. The diagnostics of an invalid manifest belong to the package.
		 */
		const { valid, value } = this.#config;
		if (!valid || !value) return done({});

		const { exports, main } = <Record<string, unknown>>value;
		const entries = new Entries(exports, main);
		const { errors, warnings } = entries;
		return done({ updated: errors.length ? void 0 : entries, errors, warnings });
	}
}
