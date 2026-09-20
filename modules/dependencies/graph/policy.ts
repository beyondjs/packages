import type { DependencyKind } from '@beyond-js/packages/dependencies/spec';
import { type OverridesType, Overrides } from './overrides';
import { Lock } from './lock';

/**
 * What the graph reports its progress to. No message ever carries a credential or a request header.
 */
export /*bundle*/ interface IGraphLogger {
	info(text: string, meta?: any): void;
	warn(text: string, meta?: any): void;
	error(text: string, meta?: any): void;
}

export /*bundle*/ interface IGraphOptions {
	// Overrides to apply. Defaults to the `overrides` of the root manifest
	overrides?: OverridesType;
	// Releases pinned by a previous resolution (see `Lock` for the accepted forms)
	lock?: any;
	// Include the development dependencies of the root, as build dependencies. Default false
	development?: boolean;
	// Resolution passes allowed before the graph is declared unsettled. Default 25
	passes?: number;
	logger?: IGraphLogger;
}

/**
 * The rules of a resolution: which dependency kinds are followed, overrides, the lock and the pass limit.
 */
export class Policy {
	#development: boolean;

	#passes: number;
	get passes() {
		return this.#passes;
	}

	#overrides: Overrides;
	get overrides() {
		return this.#overrides;
	}

	#lock: Lock;
	get lock() {
		return this.#lock;
	}

	#logger: IGraphLogger;
	get logger() {
		return this.#logger;
	}

	constructor(options: IGraphOptions = {}, roots?: Map<string, { version: string }>, declared?: OverridesType) {
		this.#development = options.development === true;
		this.#passes = options.passes > 0 ? options.passes : 25;
		this.#overrides = new Overrides(options.overrides || declared, roots);
		this.#lock = new Lock(options.lock);

		const silent = (): void => {};
		this.#logger = options.logger || { info: silent, warn: silent, error: silent };
	}

	/**
	 * Whether a dependency is part of the graph.
	 *
	 * Development dependencies never are below the root: they build or test a package, they are not what
	 * its consumers execute. Those of the root are followed only on request, as build dependencies.
	 */
	follows(kind: DependencyKind, root: boolean): boolean {
		if (kind !== 'development') return true;
		return root && this.#development;
	}
}
