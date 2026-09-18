import type { Manifest } from './';
import type { IDiagnostic } from '@beyond-js/packages/types';
import type { IManifestModuleSpec, IManifestSpec } from '@beyond-js/packages/types';
import type { IModuleManifestInfo } from '@beyond-js/packages/module/spec';
import type { Config } from '@beyond-js/config/main';
import { ModuleSpec } from '@beyond-js/packages/module/spec';
import { DynamicProcessor } from '@beyond-js/dynamic-processor/main';
import { equal } from '@beyond-js/equal/main';

interface IDone {
	updated?: Map<string, IManifestModuleSpec>;
	errors?: IDiagnostic[];
	warnings?: IDiagnostic[];
}

export class ManifestModules extends DynamicProcessor(Map<string, ModuleSpec>) {
	get dp() {
		return 'package.manifest.modules';
	}

	#manifest: Manifest;

	#config: Config;
	get config() {
		return this.#config;
	}

	#errors: IDiagnostic[] = [];
	get errors() {
		return this.#errors;
	}
	#warnings: IDiagnostic[] = [];
	get warnings() {
		return this.#warnings;
	}
	get valid() {
		return !this.#errors.length;
	}

	constructor(manifest: Manifest, config: Config) {
		super();
		this.#manifest = manifest;
		this.#config = config;

		super.setup(new Map([['config', { child: config }]]));
	}

	_process() {
		const done = ({ updated, errors, warnings }: IDone) => {
			errors = errors || [];
			warnings = warnings || [];
			updated = updated || new Map();

			const previous = { modules: [...this.keys()], errors: this.#errors, warnings: this.#warnings };
			const changed = !equal(previous, { modules: [...updated.keys()], errors, warnings });

			// Destroy unused modules spec
			this.forEach((module, bundler) => {
				if (updated?.has(bundler)) return;
				module.destroy();
				this.delete(bundler);
			});

			// Update the errors and warnings
			this.#errors = errors;
			this.#warnings = warnings;

			// Update the modules
			updated?.forEach((spec, bundler) => {
				const module = (() => {
					if (this.has(bundler)) return this.get(bundler);

					const path = this.#manifest.file.relative.dirname;
					const info: IModuleManifestInfo = { type: 'manifest', path };
					return new ModuleSpec(info, bundler);
				})();

				module.update(spec);
				this.set(bundler, module);
			});

			// Even if there are no changes of the keys of the modules, it is required to update their values,
			// so don't move it before updating the modules
			return changed;
		};

		const { errors, warnings } = this.#config;
		if (!this.#config.valid || !this.#config.value) return done({ errors, warnings });

		// Process the modules configuration
		const config = <IManifestSpec>this.#config.value;

		// Just for backward compatibility ('name' as subpath synonimous)
		const { name } = config;
		config.name = typeof name === 'string' && !name.startsWith('.') ? `./${name}` : name;
		config.subpath = config.subpath ? config.subpath : config.name;
		delete config.name;

		// For backward compatibility, the bundler property is used to define it, instead of the `bundle` property
		config.bundler = config.bundle ? config.bundle : config.bundler;
		delete config.bundle; // Avoid to detect it as a bundler

		/**
		 * A manifest that does not configure its subpath publishes the one its directory names, expressed as
		 * a package subpath so that it matches the entries of the package exports: `message` becomes
		 * `./message`, and a manifest at the package root becomes `.`
		 */
		const dirname = this.#manifest.file.relative.dirname.replace(/\\/g, '/');
		const derived = !dirname || dirname === '.' ? '.' : `./${dirname.replace(/^\.\//, '')}`;
		config.subpath = typeof config.subpath === 'string' ? config.subpath : derived;

		const updated: Map<string, Record<string, any>> = new Map();

		const isPlainObject = (value: unknown) =>
			typeof value === 'object' && value !== null && !(value instanceof Array);

		// At this point, all the common properties are removed from the config object
		if (config.bundler) {
			/**
			 * When the bundler is specified, then only one bundler is specified in the entry,
			 * so convert the entry to {bundler: ...}
			 */
			const spec: Record<string, any> = { bundler: config.bundler };
			for (const property of Object.keys(config)) {
				if (property === 'bundler') continue;

				// Move the property to the bundler spec
				spec[property] = config[<keyof IManifestModuleSpec>property];
			}

			updated.set(config.bundler, spec);
		} else if (!Object.entries(config).some(([, value]) => isPlainObject(value))) {
			/**
			 * The manifest selects no bundler and configures none: it specifies a single module, which the
			 * default bundler of the package compiles. The bundler name is left empty here, because it is a
			 * package-level decision that the modules collection applies.
			 */
			updated.set('', Object.assign({}, config));
		} else {
			// Bundler property doesn't exist, so we assume that any property that is
			// not a module property is a bundler configuration.
			const entries = Object.entries(config);

			const common: Partial<IManifestModuleSpec> = { subpath: config.subpath, description: config.description };
			delete config.description;

			// At this point, all the properties of the config object should be the modules/bundlers configuration
			for (const entry of entries) {
				const bundler = entry[0];

				if (!isPlainObject(entry[1])) {
					const code = 'INVALID_BUNDLER_CONFIG';
					const message = `Invalid bundler "${bundler}" configuration. The configuration must be an object.`;
					this.#warnings.push({ code, message });
					continue;
				}

				const spec: IManifestModuleSpec = Object.assign({}, common, entry[1], { bundler });

				// If the manifest has more than one bundler, the subpath must be prefixed with the bundler name
				spec.subpath = entries.length > 1 ? `${spec.subpath}.${bundler}` : spec.subpath;
				updated.set(bundler, spec);
			}
		}

		return done({ updated, warnings: this.#warnings });
	}
}
