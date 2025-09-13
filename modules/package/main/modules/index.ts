import type { Package } from '../';
import type { RequireType } from '@beyond-js/dynamic-processor/main';
import type { IDiagnostic } from '@beyond-js/packages/types';
import type { BaseModule } from '@beyond-js/packages/module';
import { DynamicProcessor } from '@beyond-js/dynamic-processor/main';
import { Config } from '@beyond-js/config/main';
import { equal } from '@beyond-js/equal/main';
import { ModuleExports } from './exports';
import { ModuleManifests } from './manifests';
import { ModuleResolver } from './resolver';

interface IPreparedDone {
	updated: Map<string, ModuleResolver>;
	warnings?: IDiagnostic[];
}

interface IProcessDone {
	warnings?: IDiagnostic[];
	updated: Map<string, BaseModule>;
}

export class Modules extends DynamicProcessor(Map<string, BaseModule>) {
	get dp() {
		return 'package.modules';
	}

	#package: Package;
	#exports: ModuleExports;
	#manifests: ModuleManifests;

	#resolvers: Map<string, ModuleResolver> = new Map();

	#warnings: IDiagnostic[] = [];
	get warnings() {
		return this.#warnings;
	}

	constructor(pkg: Package, config: Config) {
		super();

		this.#package = pkg;
		this.#exports = new ModuleExports(config);
		this.#manifests = new ModuleManifests(config);
	}

	_prepared(require: RequireType): void | boolean {
		if (!require(this.#exports, 'package-exports')) return false;
		if (!require(this.#manifests, 'package-manifests')) return false;

		let ready = true;
		this.#manifests.forEach(manifest => {
			const id = `manifest-modules:${manifest.file.relative.file}`;
			ready = ready && require(manifest.modules, id);
		});
		if (!ready) return false;

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
		const manifests = this.#manifests;
		const warnings: IDiagnostic[] = (this.#warnings = []);
		const updated = new Map<string, ModuleResolver>();

		// Process the exports to include their modules
		for (const [subpath, spec] of exports) {
			// Validate subpath
			const validate = /^\.\/[a-zA-Z0-9-_./]*$/;
			if (!subpath || (subpath !== '.' && (!subpath.startsWith('./') || !validate.test(subpath)))) {
				const code = 'INVALID_SUBPATH';
				const message =
					`Invalid subpath: "${subpath}". ` +
					`Subpath must be a non-empty string starting with './' and contain only valid characters.`;
				warnings.push({ code, message });
				continue;
			}

			const resolver = (() => {
				if (this.#resolvers.has(subpath)) return this.#resolvers.get(subpath);
				return new ModuleResolver(this.#package, spec);
			})();
			updated.set(subpath, resolver);
		}

		// Process the manifests to include all their modules
		for (const manifest of manifests.values()) {
			// Process each manifest modules
			manifest.modules.forEach(spec => {
				const { subpath } = spec;
				if (!subpath) throw new Error(`Module spec without subpath in "${manifest.file.relative.file}"`);
				if (updated.has(subpath)) return; // Already processed from exports

				const resolver = (() => {
					if (this.#resolvers.has(subpath)) return this.#resolvers.get(subpath);
					return new ModuleResolver(this.#package, spec);
				})();
				updated.set(subpath, resolver);
			});
		}

		return done({ updated, warnings });
	}

	_process() {
		this.clear();

		const done = ({ updated, warnings }: IProcessDone) => {
			warnings = warnings ? warnings : [];

			const previous = { modules: [...this.keys()], warnings: this.#warnings };
			const changed = !equal(previous, { modules: [...updated.keys()], warnings });

			this.#warnings = warnings;
			updated.forEach((module, subpath) => this.set(subpath, module));

			return changed;
		};

		const warnings: IDiagnostic[] = [];
		const updated = new Map<string, BaseModule>();

		this.#resolvers.forEach((resolver, key) => {
			if (!resolver.valid) {
				const code = 'INVALID_RESOLVER';
				const message = `Module resolver for "${key}" is not valid`;
				warnings.push({ code, message });
				return;
			}

			updated.set(key, resolver.module);
		});

		return done({ warnings, updated });
	}
}
