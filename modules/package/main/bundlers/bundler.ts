import type { IDiagnostic } from '@beyond-js/packages/types';
import { DynamicProcessor } from '@beyond-js/dynamic-processor/main';
import { equal } from '@beyond-js/equal/main';

export default class Bunddler extends DynamicProcessor() {
	get dp() {
		return 'package.bundler';
	}

	#path: string;
	get path() {
		return this.#path;
	}

	#errors: IDiagnostic[] = [];
	get errors() {
		return this.#errors;
	}

	get valid() {
		return !this.#errors.length;
	}

	#specifier: string;
	get specifier() {
		return this.#specifier;
	}

	// Other package level configuration set in the package.json for the bundler
	#settings: { specifier: string; [key: string]: any };
	get settings() {
		return this.#settings;
	}

	// The bundler class that implements its logic
	#Bundler: { specify: '@to-do: complete with the correct type here' };
	get Bundler() {
		return this.#Bundler;
	}

	constructor(path: string) {
		super();
		this.#path = path;
	}

	config(settings: Record<string, any>): void {
		const errors = [];
		const done = ({ updated, errors }: { updated?: Record<string, any>; errors?: IDiagnostic[] }) => {
			updated = updated ? updated : {};
			errors = errors ? errors : [];

			const previous = { errors: this.#errors, settings: this.#settings };
			if (equal(settings, this.#settings)) return;
			this._invalidate();
		};

		const updated = typeof settings === 'string' ? { specifier: settings } : settings;

		if (typeof updated !== 'object') {
			const code = 'BUNDLER_SETTINGS_INVALID';
			const message = `Bundler "${name}" settings must be an object or string`;
			errors.push({ code, message });
			return done({ errors });
		}

		const { specifier } = updated;
		if (typeof specifier !== 'string' || !specifier) {
			const code = 'BUNDLER_SPECIFIER_INVALID';
			const message = `Bundler "${name}" does not have a valid specifier`;
			return done({ errors: [{ code, message }] });
		}

		let path = null;
		try {
			path = require.resolve(specifier, { paths: [this.#path] });
		} catch (exc) {
			const code = 'BUNDLER_NOT_FOUND';
			const message = `Bundler "${specifier}" not found`;
			return done({ errors: [{ code, message }] });
		}

		try {
			this.#Bundler = require(path);
		} catch (exc) {
			const code = 'BUNDLER_REQUIRE_ERROR';
			const message = `Error requiring bundler "${specifier}": ${exc.message}`;
			return done({ errors: [{ code, message }] });
		}

		return done({ updated });
	}
}
