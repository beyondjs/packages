import type { IDiagnostic, IModuleBundlerSpec } from '@beyond-js/packages/types';
import type { FileData } from '@beyond-js/file/data';
import type { IModuleSpec } from '@beyond-js/packages/types';
import type ModulesEntries from './';
import BundlerSpec from './bundler-spec';
import { DynamicProcessor } from '@beyond-js/dynamic-processor/main';
import { Config } from '@beyond-js/config/main';
import { equal } from '@beyond-js/equal/main';
import * as path from 'path';
import { createHash } from 'crypto';
const { sep } = path;

interface IDone {
	updated?: Map<string, BundlerSpec>;
	errors?: IDiagnostic[];
	warnings?: IDiagnostic[];
}

export default class extends DynamicProcessor(Map<string, Record<string, any>>) {
	get dp() {
		return 'package.entry';
	}

	#package;
	get package() {
		return this.#package;
	}

	#file: FileData;
	get file() {
		return this.#file;
	}

	get path() {
		return this.#file.dirname;
	}

	/**
	 * The normalized relative path of the module
	 */
	get rpath() {
		let rpath = this.#file.relative.dirname;
		rpath = sep === '/' ? rpath : rpath.replace(/\\/g, '/');
		return rpath.replace(/\/$/, ''); // Remove trailing slash;
	}

	#config;
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

	constructor(modules: ModulesEntries, file: FileData) {
		super();

		const config = new Config(file.dirname, { '/static': 'object' });
		config.data = 'module.json';
		super.setup(new Map([['config', { child: config }]]));

		this.#config = config;
		this.#package = modules.package;
		this.#file = file;
	}

	_process() {
		const done = ({ updated, errors, warnings }: IDone) => {
			const changed = !equal(
				{ bundlers: [...updated.keys()], errors, warnings },
				{ bundlers: [...this.keys()], errors: this.#errors, warnings: this.#warnings }
			);

			this.#errors = errors ? errors : [];
			this.#warnings = warnings ? warnings : [];

			// Destroy unused bundlers spec
			this.forEach((spec, name) => !updated?.has(name) && spec.destroy());

			this.clear();
			updated?.forEach((spec, name) => this.set(name, spec));

			return changed;
		};

		if (!this.#config.valid) {
			return done({ errors: this.#config.errors, warnings: this.#config.warnings });
		}
		if (!this.#config.value) {
			return done({ warnings: this.#config.warnings });
		}

		// Process the bundlers configuration
		const config: IModuleSpec = <IModuleSpec>this.#config.value;

		// Just for backward compatibility ('name' as subpath synonimous)
		config.subpath = config.subpath ? config.subpath : config.name;
		let subpath = typeof config.subpath === 'string' ? config.subpath : this.rpath;
		subpath = subpath.startsWith('.') ? subpath : `./${subpath}`;

		// Validate subpath
		const validate = /^\.\/[a-zA-Z0-9-_./]*$/;
		if (!subpath || (subpath !== '.' && !subpath.startsWith('./')) || !validate.test(subpath)) {
			const code = 'INVALID_SUBPATH';
			const message =
				`Invalid subpath: "${subpath}". ` +
				`Subpath must be a non-empty string starting with './' and contain only valid characters.`;
			return done({ errors: [{ code, message }] });
		}

		delete config.name;
		delete config.subpath;

		// For backward compatibility, the bundler property is used to define it, instead of the `bundle` property
		config.bundler = config.bundle ? config.bundle : config.bundler;
		delete config.bundle; // Avoid to detect it as a bundler

		const bundlers: Map<string, Record<string, any>> = new Map();

		// At this point, all the common properties are removed from the config object
		if (config.bundler) {
			/**
			 * When the bundler is specified, then only one bundler is specified in the entry,
			 * so convert the entry to {bundler: ...}
			 */
			const spec: Record<string, any> = { bundler: config.bundler, subpath };
			for (const property of Object.keys(config)) {
				if (property === 'bundler') continue;
				if (property === 'subpath') continue; // It is invalid to define a subpath in the bundler spec

				// Move the property to the bundler spec
				spec[property] = config[<'bundler' | 'subpath'>property];
			}

			bundlers.set(config.bundler, spec);
		} else {
			const entries = Object.entries(config);

			const common = { description: config.description };
			delete config.description;

			// At this point, all the properties of the config object should be the bundlers configuration
			for (const [name, config] of entries) {
				if (typeof config !== 'object') {
					const code = 'INVALID_BUNDLER_CONFIG';
					const message = `Invalid bundler "${name}" configuration. The configuration must be an object.`;
					this.#warnings.push({ code, message });
					continue;
				}

				const spec = Object.assign({ bundler: name }, config, common);
				spec.subpath = entries.length > 1 ? `${subpath}.${name}` : subpath;
				bundlers.set(name, spec);
			}
		}

		// To uniquely identify the bundler over all the entries in the wordspace
		const id = createHash('md5').update(`${this.path}:${subpath}`).digest('hex').toString();
		bundlers.forEach((spec, name) => Object.assign(spec, { id }));

		const updated = new Map();
		bundlers.forEach((values, name) => {
			const spec = this.has(name) ? this.get(name) : new BundlerSpec();
			updated.set(name, spec);
			spec.values = values;
		});

		return done({ updated, warnings: this.#warnings });
	}
}
