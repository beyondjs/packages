import type { IDiagnostic } from '@beyond-js/packages/types';
import type { Module } from '@beyond-js/packages/sdk/module';
import { DynamicProcessor } from '@beyond-js/dynamic-processor/main';
import { equal } from '@beyond-js/equal/main';

interface IDone {
	specifier?: string;
	path?: string;
	Module?: typeof Module;
	settings?: Record<string, any>;
	errors?: IDiagnostic[];
}

export class Bundler extends DynamicProcessor() {
	get dp() {
		return 'package.bundler';
	}

	/**
	 * The name of the bundler, which is the key in the configuration.
	 */
	#name: string;
	get name() {
		return this.#name;
	}

	/**
	 * The specifier of the bundler as it is defined in the configuration.
	 */
	#specifier: string;
	get specifier() {
		return this.#specifier;
	}

	/**
	 * The path to the bundler, which is the resolved path of the specifier.
	 */
	#path: string;
	get path() {
		return this.#path;
	}

	/**
	 * The bundler class that implements its logic.
	 * This is the class that will be instantiated when the bundler is used.
	 */
	#Module: typeof Module;
	get Module(): typeof Module {
		return this.#Module;
	}

	/**
	 * Package level configuration set in the package.json for the bundler,
	 * excluding the specifier that is treated separately.
	 */
	#settings: Record<string, any>;
	get settings() {
		return this.#settings;
	}

	#errors: IDiagnostic[] = [];
	get errors() {
		return this.#errors;
	}

	get valid() {
		return !this.#errors.length;
	}

	constructor(name: string, path: string) {
		super();

		this.#name = name;
		this.#path = path;
	}

	config(settings: Record<string, any>): void {
		const done = (updated: IDone) => {
			updated = updated ? updated : {};
			const errors = updated.errors ? updated.errors : [];
			const { path, specifier, Module } = updated;

			const previous = { errors: this.#errors, path: this.#path, settings: this.#settings };
			if (equal(previous, { errors, path, settings })) return;
			this._invalidate();
		};

		const errors = [];
		settings = typeof settings === 'string' ? { specifier: settings } : settings;

		if (typeof settings !== 'object') {
			const code = 'BUNDLER_SETTINGS_INVALID';
			const message = `Bundler "${name}" settings must be an object or string`;
			errors.push({ code, message });
			return done({ errors });
		}

		const { specifier } = settings;
		delete settings.specifier;
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
			console.log(code, message);
			return done({ errors: [{ code, message }] });
		}

		let ResolvedModule: typeof Module;
		try {
			ResolvedModule = require(path);
		} catch (exc) {
			const code = 'BUNDLER_REQUIRE_ERROR';
			const message = `Error requiring bundler "${specifier}": ${exc.message}`;
			return done({ errors: [{ code, message }] });
		}

		const updated: IDone = { specifier, path, Module: ResolvedModule, settings };

		return done(updated);
	}
}
