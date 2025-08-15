import type { IDiagnostic } from '@beyond-js/packages/types';
import type { Config } from '@beyond-js/config/main';
import { DynamicProcessor } from '@beyond-js/dynamic-processor/main';
import BundlerSettings from './settings';
import { equal } from '@beyond-js/equal/main';

export interface IBundler {
	path: string;
	meta: {};
	settings: BundlerSettings;
}

interface IDone {
	updated?: Map<string, IBundler>;
	errors?: IDiagnostic[];
	warnings?: IDiagnostic[];
}

export default class Bundlers extends DynamicProcessor(Map<string, IBundler>) {
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

			this.#errors = errors;
			this.#warnings = warnings;

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
		const updated: Map<string, IBundler> = new Map();
		for (let [name, settings] of Object.entries(config)) {
			settings = typeof settings === 'string' ? { specifier: settings } : settings;
			if (typeof settings !== 'object') {
				const code = 'BUNDLER_SETTINGS_INVALID';
				const message = `Bundler "${name}" settings must be an object or string`;
				warnings.push({ code, message });
				continue;
			}

			if (this.has(name)) {
				updated.set(name, this.get(name));
				this.get(name).settings.values = settings;
				continue;
			}

			const { specifier } = settings;
			if (typeof specifier !== 'string' || !specifier) {
				const code = 'BUNDLER_SPECIFIER_INVALID';
				const message = `Bundler "${name}" does not have a valid specifier`;
				warnings.push({ code, message });
				continue;
			}

			let path = null;
			try {
				path = require.resolve(specifier, { paths: [this.#config.path] });
			} catch (exc) {
				const code = 'BUNDLER_NOT_FOUND';
				const message = `Bundler "${specifier}" not found`;
				warnings.push({ code, message });
				console.error(exc);
				continue;
			}

			try {
				const meta = require(path);
				updated.set(name, { meta, path, settings: new BundlerSettings(settings) });
			} catch (exc) {
				const code = 'BUNDLER_REQUIRE_ERROR';
				const message = `Error requiring bundler "${specifier}": ${exc.message}`;
				warnings.push({ code, message });
				console.error(exc);
			}
		}

		return done({ updated, warnings });
	}
}
