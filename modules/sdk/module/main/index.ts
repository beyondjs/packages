import { DynamicProcessor } from '@beyond-js/dynamic-processor/main';
import { Conditionals } from './conditionals';
import { ModuleSpec } from './spec';
import { dir } from 'console';

interface IModulePackage {
	name: string;
	version: string;
}

interface IPath {
	dirname: string;
	relative: string;
}

export class Module extends DynamicProcessor() {
	get dp() {
		return 'bundler-sdk.module';
	}

	#package: IModulePackage;
	get package(): IModulePackage {
		return this.#package;
	}

	#path: IPath;
	get path(): IPath {
		return this.#path;
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

	#spec;
	get spec() {
		return this.#spec;
	}

	#id;
	get id() {
		return this.#id;
	}

	#language;
	get language() {
		return this.#language;
	}

	get errors() {
		return this.#spec.errors;
	}

	get warnings() {
		return this.#spec.warnings;
	}

	get valid() {
		return this.#spec.valid;
	}

	get subpath() {
		return this.#spec.subpath;
	}

	get description() {
		return this.#spec.description;
	}

	get specifier() {
		if (!this.valid) return;

		const subpath = this.subpath === '.' ? '' : `${this.subpath.substr(1)}`;
		return `${this.#package.name}${subpath}`;
	}

	get vspecifier() {
		if (!this.valid) return;

		const subpath = this.subpath === '.' ? '' : `/${this.subpath}`;
		return `${this.#package.name}@${this.#package.version}${subpath}`;
	}

	#conditionals;
	get conditionals() {
		return this.#conditionals;
	}

	/**
	 * This method can be overriden to provide the specs values required for the processing of the conditionals
	 *
	 * @param {object} values
	 * @returns {object}
	 * @private
	 */
	_spec(values) {
		// The module should return only the specs values it will require for the processing of the conditionals
		// Take into account that a change in the specs values will invalidate the conditionals
		void values;
		return { values: {} };
	}

	_conditional({ key }) {
		void key;
		throw new Error(`Private method '_conditional' must be overriden`);
	}

	_conditionals() {
		return ['default'];
	}

	constructor({ package: { name: string, version: string }, path, bundler, specs, language }) {
		super();
		this.#package = pkg;
		this.#id = crc32(`${path.dirname}//${bundler.name}` + (language ? `//${language}` : ''));

		this.#path = { dirname: path.dirname, relative: path.relative };
		this.#bundler = bundler;
		this.#spec = new ModuleSpecs(this, specs);
		this.#language = language;

		this.#conditionals = new Conditionals(this);

		super.setup(new Map([['module-specs', { child: this.#spec }]]));
	}

	destroy() {
		this.#spec.destroy();
		this.#conditionals.destroy();
	}
}
