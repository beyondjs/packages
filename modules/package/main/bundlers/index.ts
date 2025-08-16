import type { IDiagnostic } from '@beyond-js/packages/types';
import type { Config } from '@beyond-js/config/main';
import { DynamicProcessor } from '@beyond-js/dynamic-processor/main';
import BundlerSettings from './settings';
import { equal } from '@beyond-js/equal/main';

interface IDone {
	updated?: Map<string, BundlerSettings>;
	errors?: IDiagnostic[];
	warnings?: IDiagnostic[];
}

export default class Bundlers extends DynamicProcessor(Map<string, BundlerSettings>) {
	get dp() {
		return 'package.bundlers';
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

	#config: Config;

	constructor(config: Config) {
		super();

		this.#config = <Config>config.get('bundlers');
		super.setup(new Map([['config', { child: this.#config }]]));
	}

	_process() {
		const done = ({ updated, errors, warnings }: IDone) => {
			errors = errors ? errors : [];
			warnings = warnings ? warnings : [];
			updated = updated ? updated : new Map();

			const changed = equal(
				{ updated: [...updated.keys()], errors, warnings },
				{ updated: [...this.keys()], errors: this.#errors, warnings: this.#warnings }
			);
			if (!changed) return false;

			// Destoy unused bundler settings
			this.forEach((settings, name) => !updated.has(name) && settings.destroy());

			// Set updated errors and warnings
			this.#errors = errors;
			this.#warnings = warnings;

			// Set updated values
			this.clear();
			updated.forEach((value, key) => this.set(key, value));
			return changed;
		};

		if (!this.#config.valid) {
			const { errors, warnings } = this.#config;
			return done({ errors, warnings });
		}

		const config = this.#config.value;
		if (typeof config !== 'object' || config instanceof Array) {
			const code = 'BUNDLERS_CONFIG_INVALID';
			const message = `Invalid bundlers configuration, configuration must be an object`;
			return done({ errors: [{ code, message }] });
		}

		const warnings: IDiagnostic[] = [];
		const updated: Map<string, BundlerSettings> = new Map();
		for (let [name, values] of Object.entries(config)) {
			if (this.has(name)) {
				updated.set(name, this.get(name));
				this.get(name).config(values);
				continue;
			}

			const bs = new BundlerSettings(this.#config.path);
			bs.config(values);
			updated.set(name, bs);
		}

		return done({ updated, warnings });
	}
}
