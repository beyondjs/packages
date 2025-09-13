import type { ModuleSpec } from '@beyond-js/packages/module/spec';
import type { IConditions } from '@beyond-js/packages/types';
import type { BaseConditional } from './conditionals/conditional';
import type { DynamicProcessorImplementation } from '@beyond-js/dynamic-processor/main';
import type { Package } from './package';
import { Conditionals } from './conditionals';

interface IBundler extends DynamicProcessorImplementation {
	path: string;
	specifier: string;
	settings: Record<string, any>;
}

interface IModuleConstructorParams {
	package: Package;
	spec: ModuleSpec;
	bundler: IBundler;
}

export /*bundle*/ abstract class BaseModule {
	get dp() {
		return 'module';
	}

	#package: Package;
	get package(): Package {
		return this.#package;
	}

	#spec: ModuleSpec;
	get spec(): ModuleSpec {
		return this.#spec;
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

	abstract _conditional({ key, conditions }: { key: string; conditions: IConditions }): BaseConditional;

	constructor({ package: pkg, bundler, spec }: IModuleConstructorParams) {
		this.#package = pkg;
		this.#bundler = bundler;
		this.#spec = spec;

		this.#conditionals = new Conditionals(this);
	}

	destroy() {
		this.#conditionals.destroy();
	}
}
