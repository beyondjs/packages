import type { RequireType } from '@beyond-js/dynamic-processor/main';
import type { Config } from '@beyond-js/config/main';
import { DynamicProcessor } from '@beyond-js/dynamic-processor/main';
import ModulesResolvers from './resolvers';

export default class PackageModules extends DynamicProcessor(Map<string, {}>) {
	get dp() {
		return 'package.modules';
	}

	#package: { name: string; version: string };
	get package() {
		return this.#package;
	}

	#config: Config;

	#resolvers: ModulesResolvers;
	get resolvers() {
		return this.#resolvers;
	}

	get path(): { dirname: string; relative: string } {
		const relative = this.#config.value.path;
	}

	#propagator;

	constructor(pkg: { name: string; version: string }, config: Config) {
		super();

		this.#package = pkg;
		const resolvers = (this.#resolvers = new ModulesResolvers(pkg, config));
		super.setup(new Map([['resolvers', { child: resolvers }]]));

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
