import type { IDiagnostic, BundlerSettingsType } from '@beyond-js/packages/types';
import type { BaseModule } from '@beyond-js/packages/module';
import type { IRequest } from '@beyond-js/dynamic-processor/main';
import { DynamicProcessor } from '@beyond-js/dynamic-processor/main';
import { equal } from '@beyond-js/equal/main';
import { importer } from './importer';

type BaseModuleArgs = ConstructorParameters<typeof BaseModule>;
export type ModuleConstructor<T extends BaseModule> = new (...args: BaseModuleArgs) => T;

interface IDone {
	specifier?: string;
	path?: string;
	Module?: ModuleConstructor<BaseModule>;
	settings?: Record<string, unknown>;
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

	#config: BundlerSettingsType;

	/**
	 * The specifier of the bundler as it is defined in the configuration.
	 */
	#specifier: string;
	get specifier() {
		return this.#specifier;
	}

	/**
	 * Package level configuration set in the package.json for the bundler,
	 * excluding the specifier that is treated separately.
	 */
	#settings: Record<string, unknown>;
	get settings() {
		return this.#settings;
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
	#Module: ModuleConstructor<BaseModule>;
	get Module(): ModuleConstructor<BaseModule> {
		return this.#Module;
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

	config(config: BundlerSettingsType): void {
		this.#config = config;
		this._invalidate();
	}

	async _process(request: IRequest): Promise<void | boolean> {
		const done = (updated: IDone): void | boolean => {
			updated = updated ? updated : {};
			const errors = updated.errors ? updated.errors : [];
			const { path, specifier, settings, Module } = updated;

			const previous = {
				errors: this.#errors,
				path: this.#path,
				specifier: this.#specifier,
				settings: this.#settings
			};
			if (equal(previous, { errors, path, specifier, settings })) return false;

			this.#errors = errors;
			this.#specifier = specifier;
			this.#Module = Module;
			this.#settings = settings;
		};

		let errors = [];
		const settings: Record<string, unknown> =
			typeof this.#config === 'string' ? { specifier: this.#config } : this.#config;

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

		let Module: ModuleConstructor<BaseModule>, path: string;
		({ errors, Module, path } = await importer(specifier, this.#path));
		if (request !== this._request) return;

		const updated: IDone = { Module, specifier, path, settings };

		return done(updated);
	}
}
