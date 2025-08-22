import type { ModuleSpec } from '@beyond-js/packages/module/spec';
import type { IConditions } from '@beyond-js/packages/types';
import type { Conditional } from './conditionals/conditional';
import { Conditionals } from './conditionals';
import { relative } from 'path';

interface IBundler {
	path: string;
	specifier: string;
	settings: Record<string, any>;
}

interface IModulePackage {
	id: string;
	name: string;
	version: string;
	path: string;
}

interface IModuleConstructorParams {
	package: IModulePackage;
	id: string;
	path: string;
	language: string;
	bundler: IBundler;
	spec: ModuleSpec;
}

export /*bundle*/ abstract class BaseModule {
	get dp() {
		return 'module';
	}

	#package: IModulePackage;
	get package(): IModulePackage {
		return this.#package;
	}

	#id: string;
	get id(): string {
		return this.#id;
	}

	#path: { dirname: string; relative: string };
	get path() {
		return this.#path;
	}

	#language: string;
	get language() {
		return this.#language;
	}

	/**
	 * Bundler
	 * .path {string} The path where the bundler was located when required
	 * .settings {object} as they are defined in the package.json file
	 */
	#bundler: IBundler;
	get bundler() {
		return this.#bundler;
	}

	#spec: ModuleSpec;
	get spec(): ModuleSpec {
		return this.#spec;
	}

	#conditionals: Conditionals;
	get conditionals() {
		return this.#conditionals;
	}

	/**
	 * This method can be overriden to provide the spec values required for the processing of the conditionals
	 */
	_spec(values: Record<string, any> = {}): { values: Record<string, any> } {
		// The module should return only the spec values it will require for the processing of the conditionals
		// Take into account that a change in the spec values will invalidate the conditionals
		void values;
		return { values: {} };
	}

	abstract _conditionals(): IConditions[];

	abstract _conditional({ key }: { key: string }): Conditional;

	constructor({ package: pkg, id, path, bundler, spec, language }: IModuleConstructorParams) {
		this.#package = pkg;
		this.#id = id;

		this.#path = { dirname: path, relative: relative(path, pkg.path) };
		this.#bundler = bundler;
		this.#spec = spec;
		this.#language = language;

		this.#conditionals = new Conditionals(this);
	}
}
