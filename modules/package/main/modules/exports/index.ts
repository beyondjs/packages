import type { RequireType } from '@beyond-js/dynamic-processor/main';
import type { IDiagnostic } from '@beyond-js/packages/types';
import type { ExportsEntry } from '@beyond-js/packages/sdk/types';
import { DynamicProcessor } from '@beyond-js/dynamic-processor/main';
import { Config } from '@beyond-js/config/main';
import { equal } from '@beyond-js/equal/main';

interface IDone {
	errors?: IDiagnostic[];
	warnings?: IDiagnostic[];
	values?: [string, ExportsEntry][]; // Object entries
}

export class ModuleExports extends DynamicProcessor(Map<string, ExportsEntry>) {
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
		const done = ({ errors, warnings, values }: IDone) => {
			errors = errors ? errors : [];
			warnings = warnings ? warnings : [];
			values = values ? values : [];

			const previous = { errors: this.#errors, warnings: this.#warnings, values: [...this.entries()] };
			const changed = !equal(previous, { errors, warnings, values });
			if (!changed) return false;

			this.clear();
			values.forEach(([key, value]) => this.set(key, value));
		};

		const exports = this.#config.get('exports');
		if (!exports.valid) return done({ errors: exports.errors, warnings: exports.warnings });

		const values = Object.entries(exports.value);
		return done({ values, warnings: exports.warnings });
	}
}
