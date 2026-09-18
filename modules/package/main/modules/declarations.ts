import type { IDiagnostic, IManifestModuleSpec } from '@beyond-js/packages/types';
import type { ModuleExports } from './exports';
import type { ModuleManifests } from './manifests';
import { ModuleSpec } from '@beyond-js/packages/module/spec';

/**
 * One public module of a package, as declared by the package exports, by a module manifest, or by both
 */
export interface IDeclaration {
	subpath: string;

	/**
	 * The bundler selected by the manifest, or the default bundler of the package. A module whose bundler
	 * remains undefined cannot be resolved, and its resolver reports it.
	 */
	bundler: string;

	/**
	 * The directory of the module, relative to the package
	 */
	path?: string;

	/**
	 * The configuration of the bundler, combining the entry point with the values of the manifest
	 */
	values: Record<string, any>;

	/**
	 * Which declarations produced this module, `exports` and the manifest files, used to report conflicts
	 */
	sources: string[];
}

/**
 * Combines how a package declares its public modules into one specification per subpath.
 *
 * A package declares its public API through the `exports` of its manifest: an entry whose target is a
 * source file is the entry point of a Beyond public module, and the exports of that file are the API of
 * the module. A `module.json` in the directory of a module adds its specification, such as the platforms
 * to build or the options of its bundler, and can select which bundler compiles it; when it does not, the
 * default bundler of the package applies. A manifest whose subpath is not published by the exports
 * declares a module on its own.
 *
 * Contradictions between the two are reported instead of silently resolved: a subpath declared by two
 * manifests, a manifest whose directory is not where the exports entry points, or a manifest for an entry
 * that is not a source file.
 */
export class Declarations extends Map<string, IDeclaration> {
	#errors: IDiagnostic[] = [];
	get errors() {
		return this.#errors;
	}

	#warnings: IDiagnostic[] = [];
	get warnings() {
		return this.#warnings;
	}

	/**
	 * @param exports The entries of the package exports
	 * @param manifests The module manifests found in the package
	 * @param bundler The default bundler of the package, applied to the modules that select none
	 */
	constructor(exports: ModuleExports, manifests: ModuleManifests, bundler?: string) {
		super();

		this.#exports(exports);
		this.#manifests(manifests);

		this.forEach(declaration => (declaration.bundler = declaration.bundler || bundler));
	}

	/**
	 * Declares the modules published by the package exports
	 */
	#exports(exports: ModuleExports): void {
		// An unsupported shape of the exports field publishes nothing, which its diagnostics explain
		exports.errors.forEach(error => this.#errors.push(error));
		exports.warnings.forEach(warning => this.#warnings.push(warning));

		for (const [subpath, spec] of exports) {
			const validate = /^\.\/[a-zA-Z0-9-_./]*$/;
			if (!subpath || (subpath !== '.' && (!subpath.startsWith('./') || !validate.test(subpath)))) {
				const code = 'INVALID_SUBPATH';
				const message =
					`Invalid subpath: "${subpath}". ` +
					`Subpath must be a non-empty string starting with './' and contain only valid characters.`;
				this.#warnings.push({ code, message });
				continue;
			}

			const entry = ModuleSpec.entry(spec.values);
			if (entry) {
				/**
				 * A source entry point declares a Beyond public module. Its bundler is not known yet: the
				 * manifest of the same subpath can select it, and the package default applies otherwise.
				 */
				const values = { entry: entry.entry };
				this.set(subpath, { subpath, bundler: void 0, path: entry.path, values, sources: ['exports'] });
			} else {
				// Any other target is an export of the package, packaged as such and not compiled from sources
				const values = <Record<string, any>>spec.values;
				this.set(subpath, { subpath, bundler: 'exports', values, sources: ['exports'] });
			}
		}
	}

	/**
	 * Adds the specifications of the module manifests, completing the entries of the package exports and
	 * declaring the modules the exports do not publish
	 */
	#manifests(manifests: ModuleManifests): void {
		for (const manifest of manifests.values()) {
			const file = manifest.file.relative.file;

			manifest.modules.forEach(spec => {
				const { subpath } = spec;
				if (!subpath) {
					const code = 'MODULE_SUBPATH_MISSING';
					const message = `Module manifest "${file}" does not resolve a subpath`;
					this.#errors.push({ code, message });
					return;
				}

				// The subpath and the bundler are declaration data, the rest configures the bundler
				const values = <IManifestModuleSpec & Record<string, any>>Object.assign({}, spec.values);
				delete values.subpath;
				delete values.bundler;

				const declared = this.get(subpath);
				if (declared && !this.#complete(declared, spec, file)) return;
				if (declared) {
					declared.bundler = spec.bundler || void 0;
					declared.values = Object.assign({}, values, declared.values);
					declared.sources.push(file);
					return;
				}

				this.set(subpath, {
					subpath,
					bundler: spec.bundler || void 0,
					path: spec.path,
					values,
					sources: [file]
				});
			});
		}
	}

	/**
	 * Whether a manifest completes an already declared module, or contradicts it. A contradicting
	 * declaration is reported and the module is removed, because which of the two applies is not decidable.
	 */
	#complete(declared: IDeclaration, spec: ModuleSpec, file: string): boolean {
		const { subpath } = declared;

		const previous = declared.sources.filter(source => source !== 'exports');
		if (previous.length) {
			const code = 'MODULE_DUPLICATED';
			const message = `Module "${subpath}" is declared by more than one manifest: ${previous.join(', ')} and "${file}"`;
			this.#errors.push({ code, message });
			this.delete(subpath);
			return false;
		}

		if (declared.bundler === 'exports') {
			const code = 'MODULE_ENTRY_INVALID';
			const message =
				`Module "${subpath}" has a manifest ("${file}") but its exports target is not a source entry point. ` +
				`Point the exports entry to the source file of the module entry point`;
			this.#errors.push({ code, message });
			this.delete(subpath);
			return false;
		}

		if (declared.path !== spec.path) {
			const code = 'MODULE_ENTRY_CONFLICT';
			const message =
				`Module "${subpath}" exports entry is located at "${declared.path || '.'}" ` +
				`but its manifest "${file}" is located at "${spec.path || '.'}"`;
			this.#errors.push({ code, message });
			this.delete(subpath);
			return false;
		}

		return true;
	}
}
