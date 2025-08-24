import type { Package } from '../';
import type { RequireType } from '@beyond-js/dynamic-processor/main';
import type { IDiagnostic } from '@beyond-js/packages/types';
import type { BaseModule } from '@beyond-js/packages/module';
import { DynamicProcessor } from '@beyond-js/dynamic-processor/main';
import { Config } from '@beyond-js/config/main';
import { ModuleExports } from './exports';
import { ModuleManifests } from './manifests';
import { ModuleResolver } from './resolver';

interface IPreparedDone {
	updated: Map<string, ModuleResolver>;
	warnings?: IDiagnostic[];
}

export class Modules extends DynamicProcessor(Map<string, BaseModule>) {
	get dp() {
		return 'package.modules';
	}

	#package: Package;
	#exports: ModuleExports;
	#manifests: ModuleManifests;

	#resolvers: Map<string, ModuleResolver> = new Map();

	#errors: IDiagnostic[] = [];
	get errors() {
		return this.#errors;
	}
	#warnings: IDiagnostic[] = [];
	get warnings() {
		return this.#warnings;
	}
	get valid() {
		return !this.#errors?.length;
	}

	constructor(pkg: Package, config: Config) {
		super();

		this.#package = pkg;
		this.#exports = new ModuleExports(config);
		// this.#manifests = new ModuleManifests(config);
	}

	_prepared(require: RequireType): void | boolean {
		if (!require(this.#exports, 'package-exports')) return false;
		// require(this.#manifests, 'package-manifests');

		const done = ({ updated, warnings }: IPreparedDone) => {
			warnings = warnings ? warnings : [];
			this.#warnings = warnings;

			// Destroy unused resolvers
			this.#resolvers.forEach((resolver, subpath) => !updated.has(subpath) && resolver.destroy());
			this.#resolvers.clear();

			// Add the updated resolvers collection
			updated.forEach((resolver, subpath) => this.#resolvers.set(subpath, resolver));

			// The resolvers must be all processed before processing the modules collection
			this.#resolvers.forEach((resolver, key) => require(resolver, `module-resolver:${key}`));
		};

		const exports = this.#exports;
		const warnings: IDiagnostic[] = (this.#warnings = []);
		const updated = new Map<string, ModuleResolver>();

		for (const [subpath, specs] of exports) {
			// Validate subpath
			const validate = /^\.\/[a-zA-Z0-9-_./]*$/;
			if (!subpath || (subpath !== '.' && !subpath.startsWith('./')) || !validate.test(subpath)) {
				const code = 'INVALID_SUBPATH';
				const message =
					`Invalid subpath: "${subpath}". ` +
					`Subpath must be a non-empty string starting with './' and contain only valid characters.`;
				warnings.push({ code, message });
				continue;
			}

			const resolver = (() => {
				if (this.#resolvers.has(subpath)) return this.#resolvers.get(subpath);
				return new ModuleResolver(this.#package, specs);
			})();
			updated.set(subpath, resolver);
		}

		return done({ updated, warnings });
	}

	_process() {
		this.clear();
		this.#resolvers.forEach((resolver, key) => this.set(key, resolver.module));
	}
}
