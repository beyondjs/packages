import { DynamicProcessor } from '@beyond-js/dynamic-processor/main';
import { Conditionals } from './conditionals';

interface IModuleConstructorParams {
	bundler: { path: string };
	spec: Record<string, any>;
}

export class Module extends DynamicProcessor() {
	get dp() {
		return 'bundler-sdk.module';
	}

	#package: IModulePackage;
	get package(): IModulePackage {
		return this.#package;
	}

	/**
	 * Bundler
	 * .path {string} The path where the bundler was located when required
	 * .settings {object} as they are defined in the package.json file
	 */
	#bundler;
	get bundler() {
		return this.#bundler;
	}

	#spec: Record<string, any>;
	get spec() {
		return this.#spec;
	}

	#id;
	get id() {
		return this.#id;
	}

	#conditionals;
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

	_conditionals(): string[] {
		return ['default'];
	}

	_conditional({ key }: { key: string }): Conditional {
		void key;
		throw new Error(`Private method '_conditional' must be overriden`);
	}

	constructor({ package, path, bundler, specs, language }: IModuleConstructorParams) {
		super();
		this.#package = pkg;
		this.#id = crc32(`${path.dirname}//${bundler.name}` + (language ? `//${language}` : ''));

		this.#path = { dirname: path.dirname, relative: path.relative };
		this.#bundler = bundler;
		this.#language = language;

		this.#conditionals = new Conditionals(this);
	}

	destroy() {
		this.#spec.destroy();
		this.#conditionals.destroy();
	}
}
