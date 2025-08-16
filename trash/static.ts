import type { FilterSpec } from '@beyond-js/finder/types';
import type { RequireType } from '@beyond-js/dynamic-processor/main';
import type { IDiagnostic } from '@beyond-js/packages/types';
import { DynamicProcessor } from '@beyond-js/dynamic-processor/main';
import { Config } from '@beyond-js/config/main';
import { equal } from '@beyond-js/equal/main';

interface IDone {
	updated?: FilterSpec;
	errors?: IDiagnostic[];
	warnings?: IDiagnostic[];
}

export class ManifestStatic extends DynamicProcessor() {
	get dp() {
		return 'package.manifest.static';
	}

	#config: Config;

	#filter: string | FilterSpec;
	get filter() {
		return this.#filter;
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
		return !this.#errors.length;
	}

	constructor(config: Config) {
		super();
		this.#config = config;
	}

	_prepared(require: RequireType) {
		require(this.#config, 'package-manifest-static-config');
	}

	_process() {
		const { value, valid, errors, warnings } = this.#config;

		const done = ({ updated, errors, warnings }: IDone) => {
			errors = errors ? errors : [];
			warnings = warnings ? warnings : [];
			updated = updated ? updated : {};

			const previous = { filter: this.#filter, errors: this.#errors, warnings: this.#warnings };
			const changed = !equal(previous, { filter: updated, errors, warnings });
			if (!changed) return false;
		};

		if (!valid) return done({ errors, warnings });

		const filter = <IFilterSpec>value;
		return done({ updated: filter });
	}
}
