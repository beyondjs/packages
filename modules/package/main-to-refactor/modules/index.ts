import type { RequireType } from '@beyond-js/dynamic-processor/main';
import type { Package } from '..';
import type { Config } from '@beyond-js/config/main';
import { DynamicProcessor } from '@beyond-js/dynamic-processor/main';
import ModulesResolvers from './resolvers';
import { relative } from 'path';

export default class PackageModules extends DynamicProcessor(Map<string, {}>) {
	get dp() {
		return 'package.modules';
	}

	#package: Package;
	get package() {
		return this.#package;
	}

	#resolvers: ModulesResolvers;
	get resolvers() {
		return this.#resolvers;
	}

	get path() {
		return this.#resolvers.path;
	}

	get rpath() {
		if (!this.path) return;
		return relative(this.#package.path, this.path);
	}

	#seekers;
	get seekers() {
		return this.#seekers;
	}

	#propagator;

	/**
	 * Application modules constructor
	 *
	 * @param package {object} The package object
	 * @param config {object} The modules configuration
	 */
	constructor(pkg: Package, config: Config) {
		super();
		this.setMaxListeners(500); // One listener per seekers is require

		this.#package = pkg;

		const resolvers = (this.#resolvers = new ModulesResolvers(pkg, config));
		super.setup(new Map([['resolvers', { child: resolvers }]]));

		this.#seekers = new (require('./seekers'))(pkg);
		this.#propagator = new (require('./propagator'))(this._events);
	}

	_prepared(require: RequireType) {
		// Be sure that the modules are ready before the entries are processed
		const resolvers = this.#resolvers;
		resolvers.forEach(resolver => require(resolver, resolver.id));
	}

	_process() {
		const resolvers = this.#resolvers;
		const updated = new Map();
		resolvers.forEach(resolver => resolver.valid && updated.set(resolver.id, resolver.module));

		// Check if modules has changed
		const changed = (() => {
			if (this.size !== updated.size) return true;
			return [...updated.keys()].reduce((prev, module) => prev || !this.has(module.id), false);
		})();
		if (!changed) return false;

		// Subscribe modules that are new to the resolvers
		this.#propagator.subscribe([...updated.values()].filter(module => !this.has(module.id)));

		// Unsubscribe unused modules
		this.#propagator.unsubscribe([...this.values()].filter(module => !updated.has(module.id)));

		// Destroy the unused modules
		[...this.values()].forEach(module => !updated.has(module.id) && module.destroy());

		// Set the processed resolvers
		super.clear(); // Do not use this.clear() as it would unsubscribe reused modules
		updated.forEach(module => this.set(module.id, module));
	}

	clear() {
		this.#propagator.unsubscribe([...this.values()]);
		super.clear();
	}

	destroy() {
		super.destroy();
		this.clear();
	}
}
