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

		const exports = this.#exports;
		const warnings: IDiagnostic[] = (this.#warnings = []);
		const resolvers = (this.#resolvers = new Map<string, ModuleResolver>());

		const done = ({ warnings }: IPreparedDone) => {
			warnings = warnings ? warnings : [];
			this.#warnings = warnings;
		};

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

			const resolver = new ModuleResolver(this.#package, specs);
			resolvers.set(subpath, resolver);
		}

		// All resolvers must be processed
		resolvers.forEach(resolver => require(resolver, 'module-resolver'));
	}

	_process() {
		const resolvers = this.#resolvers;
	}
}
