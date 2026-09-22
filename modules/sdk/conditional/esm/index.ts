import type { IDiagnostic } from '@beyond-js/packages/types';
import type { ProcessorOutput } from '../processor/outputs/output';
import type { IWidgetSpecs } from './widget';
import { Conditional } from '../main';
import { ConditionalOutput } from '@beyond-js/packages/module/output';
import { Minifier } from './minifier';
import { equal } from '@beyond-js/equal/main';
import { Assembler } from './assembler';
import { Outputs } from './outputs';
import { Widget } from './widget';

export type { IWidgetDeclaration, IWidgetSpecs } from './widget';

/**
 * One internal module of a public module artifact: the transformed code of a source file, addressed by
 * an identity that is stable across builds and by a hash of its content
 */
export interface IInternalModule {
	/**
	 * The path of the source file relative to the module directory, without extension, for example
	 * `./format`. Internal requires are resolved against these identities by the runtime.
	 */
	id: string;

	/**
	 * The hash of the emitted code. The runtime replaces a creator only when its hash changed, which is
	 * what makes an update affect the internal modules that actually changed.
	 */
	hash: number;

	output: ProcessorOutput;
}

/**
 * The description of an assembled artifact, for the consumers that deliver it and resolve its references
 */
export /*bundle*/ interface IESMArtifact {
	/**
	 * The versioned identity of the public module: `${package}@${version}/${subpath}`
	 */
	vspecifier: string;

	/**
	 * The public bare specifiers the artifact imports
	 */
	dependencies: string[];

	/**
	 * The public API: the names exported by the entry point of the module
	 */
	exports: string[];

	/**
	 * The internal modules composing the artifact, with their content hashes. A packaged artifact has none.
	 */
	ims: { id: string; hash: number }[];

	/**
	 * How the sources of the module reach the runtime: `creators` registers one internal module per source
	 * file in the runtime package, `packaged` bundles them into the ES module itself. Absent means `creators`.
	 */
	composition?: 'creators' | 'packaged';

	/**
	 * The runtime public module a `creators` artifact imports. A packaged artifact has none.
	 */
	runtime?: string;

	/**
	 * Whether the module produces a stylesheet beside its code
	 */
	styles?: boolean;

	/**
	 * The registration of the widget the module declares, when it is one
	 */
	widget?: IWidgetSpecs;

	/**
	 * The public modules a packaged artifact re-exports with `export *`, whose names are not listed in `exports`
	 */
	stars?: string[];

	/**
	 * The source files a packaged artifact was bundled from, relative to the module directory
	 */
	inputs?: string[];

	/**
	 * The compiler that produced a packaged artifact, as its bundler resolved it
	 */
	compiler?: { specifier: string; version: string; location?: string; assigned: boolean; provenance?: Record<string, unknown> };
}

/**
 * Assembles the internal modules produced by the processors of a conditional into the executable artifact
 * of a public module.
 *
 * The emitted file is a native ES module: its public dependencies stay bare imports, and its public API is
 * a set of live bindings. Inside it, the sources of the module are not separate ES modules but creator
 * functions registered in the runtime package, each identified and hashed. That composition is what allows
 * an update to replace the code of one source file while the public module keeps its identity, its
 * consumers and the rest of its internal state.
 *
 * Three outputs are produced from the same processors:
 *
 * - `output`, the artifact that creates the runtime package and initialises it
 * - `patch`, the update that addresses the package already loaded under the same identity and replaces
 *   only the internal modules whose hash changed
 * - `styles`, the stylesheet of the module, concatenated from every style output in a stable order, which
 *   the artifact tells the runtime to register for the module
 *
 * Producing a patch is compilation, not application: delivering it and applying it to a running consumer
 * belongs to the development service and the runtime.
 *
 * A concrete bundler extends this class through the `Conditional` contract (`_spec`, `_processors`); the
 * TypeScript bundler is the reference implementation.
 */
export /*bundle*/ abstract class ESMConditional extends Conditional {
	#output: ConditionalOutput;

	/**
	 * The artifact of the module, or undefined while the conditional is not valid
	 */
	get output(): ConditionalOutput {
		return this.#output;
	}

	#patch: ConditionalOutput;

	/**
	 * The update of the module, which applies to a runtime package already loaded from `output`
	 */
	get patch(): ConditionalOutput {
		return this.#patch;
	}

	#styles: ConditionalOutput;

	/**
	 * The stylesheet of the module, or undefined when its sources produce none
	 */
	get styles(): ConditionalOutput | undefined {
		return this.#styles;
	}

	#types: ConditionalOutput;

	/**
	 * The public declaration of the module, or undefined when no processor produces one
	 */
	get types(): ConditionalOutput | undefined {
		return this.#types;
	}

	#artifact: IESMArtifact;

	/**
	 * The identities, public API, dependencies and internal modules of the assembled artifact
	 */
	get artifact(): IESMArtifact {
		return this.#artifact;
	}

	#errors: IDiagnostic[] = [];

	/**
	 * The assembly diagnostics, including the issues reported by the processors for each source file,
	 * concatenated with the ones of the conditional itself
	 */
	get errors(): IDiagnostic[] {
		return this.#errors.concat(super.errors);
	}

	#warnings: IDiagnostic[] = [];
	get warnings(): IDiagnostic[] {
		return this.#warnings.concat(super.warnings);
	}

	get valid(): boolean {
		return !this.#errors.length && super.valid;
	}

	/**
	 * The entry point of the conditional: the one its own specification names, which a per-conditional
	 * section of the manifest can select, or else the entry point of the module
	 */
	get entry(): string | undefined {
		const values = <{ entry?: unknown }>this.spec.values;
		return typeof values?.entry === 'string' && values.entry ? values.entry : this.module.spec.entry;
	}

	/**
	 * The identity of an internal module, derived from the path of its source file relative to the module
	 * directory: `format.ts` becomes `./format`, which is what a relative require resolves to at runtime
	 */
	static id(file: string): string {
		const normalized = file.replace(/\\/g, '/').replace(/\.[^/.]+$/, '');
		return normalized.startsWith('./') ? normalized : `./${normalized}`;
	}

	/**
	 * The content hash of an internal module: a 32-bit FNV-1a of its emitted code.
	 *
	 * The runtime compares these hashes to decide which creators an update replaces, so the value only needs
	 * to change with the code and to fit the numeric hash of the runtime contract.
	 */
	static hash(code: string): number {
		let hash = 0x811c9dc5;
		for (let i = 0; i < code.length; i++) {
			hash ^= code.charCodeAt(i);
			hash = Math.imul(hash, 0x01000193) >>> 0;
		}
		return hash;
	}

	_process(): boolean | Promise<boolean> {
		const done = (updated: {
			errors?: IDiagnostic[];
			warnings?: IDiagnostic[];
			output?: ConditionalOutput;
			patch?: ConditionalOutput;
			styles?: ConditionalOutput;
			types?: ConditionalOutput;
			artifact?: IESMArtifact;
		}): boolean => {
			const errors = updated.errors ?? [];
			const warnings = updated.warnings ?? [];

			/**
			 * The hashes identify the emitted code and stylesheet, so reprocessing that produces the same
			 * outputs is not reported as a change: consumers and update services are only notified of real
			 * differences.
			 */
			const previous = { errors: this.#errors, warnings: this.#warnings, hash: this.#output?.hash, styles: this.#styles?.hash, types: this.#types?.hash };
			const current = { errors, warnings, hash: updated.output?.hash, styles: updated.styles?.hash, types: updated.types?.hash };
			const changed = !equal(previous, current);

			this.#errors = errors;
			this.#warnings = warnings;
			this.#output = updated.output;
			this.#patch = updated.patch;
			this.#styles = updated.styles;
			this.#types = updated.types;
			this.#artifact = updated.artifact;
			return changed;
		};

		const outputs = new Outputs(this.processors, ESMConditional.id, ESMConditional.hash);
		const { warnings } = outputs;
		if (outputs.errors.length) return done({ errors: outputs.errors, warnings });

		const { module } = this;
		const { entry } = this;
		if (!entry) {
			const code = 'MODULE_ENTRY_MISSING';
			const message = `Module "${module.spec.subpath}" does not define its entry point`;
			return done({ errors: [{ code, message }], warnings });
		}

		/**
		 * A module whose entry point is a stylesheet publishes no code: its artifact is an empty public module
		 * whose stylesheet is what consumers link, such as the shared `global` sheet of a package
		 */
		const stylesheet = /\.(css|scss|sass)$/.test(entry);
		const id = stylesheet ? void 0 : ESMConditional.id(entry);
		if (!stylesheet && !outputs.ims.some(im => im.id === id)) {
			const code = 'MODULE_ENTRY_NOT_FOUND';
			const message = `Entry point "${entry}" of module "${module.spec.subpath}" was not processed`;
			return done({ errors: [{ code, message }], warnings });
		}

		const { package: pkg } = module;
		const subpath = module.spec.subpath.replace(/^\.\/?/, '');
		const vspecifier = subpath ? `${pkg.vname}/${subpath}` : pkg.vname;

		// A package selects the runtime its composed modules are written against in the settings of the bundler
		const { runtime } = <{ runtime?: unknown }>(module.bundler?.settings ?? {});
		if (runtime !== void 0 && (typeof runtime !== 'string' || !runtime)) {
			const code = 'RUNTIME_INVALID';
			const message = `The "runtime" setting of bundler "${module.bundler.specifier}" must be the specifier of a public module`;
			return done({ errors: [{ code, message }], warnings });
		}

		// A widget adopts the shared `global` stylesheet of its package when the package publishes one
		const widget = new Widget((<{ widget?: unknown }>this.spec.values)?.widget, vspecifier, pkg.modules.has('./global'));
		if (widget.errors.length) return done({ errors: widget.errors, warnings });

		const styles = outputs.styles(vspecifier);
		const types = outputs.types(vspecifier);
		const assembler = new Assembler({ vspecifier, entry: id, ims: outputs.ims, runtime: <string>runtime, styles: !!styles, widget });
		if (assembler.errors.length) return done({ errors: assembler.errors, warnings });

		const artifact = this.#describe(vspecifier, assembler, styles, widget);

		// The production conditional is the same composition, minified, without a map or an update patch
		if (this.environment === 'production') {
			const minified = (minifier: Minifier) => {
				const output = new ConditionalOutput();
				output.set({ code: minifier.code(assembler.assemble({ hmr: false }).code), map: void 0 });
				let sheet: ConditionalOutput | undefined;
				if (styles) {
					sheet = new ConditionalOutput();
					sheet.set({ code: minifier.css(styles.code()), map: void 0 });
				}
				return done({ output, patch: void 0, styles: sheet, types, artifact, warnings });
			};
			const failed = (error: Error) => done({ errors: [{ code: 'MINIFY_ERROR', message: `Module "${module.spec.subpath}": ${error.message}` }], warnings });
			return Minifier.load().then(minifier => {
				try {
					return minified(minifier);
				} catch (error) {
					return failed(error as Error);
				}
			}, failed);
		}

		const output = new ConditionalOutput();
		output.set(assembler.assemble({ hmr: false }));

		const patch = new ConditionalOutput();
		patch.set(assembler.assemble({ hmr: true }));

		return done({ output, patch, styles, types, artifact, warnings });
	}

	/**
	 * What the artifact of this conditional declares to consumers: the same for development and production
	 */
	#describe(vspecifier: string, assembler: Assembler, styles: ConditionalOutput | undefined, widget: Widget): IESMArtifact {
		return {
			vspecifier,
			runtime: assembler.runtime,
			dependencies: assembler.dependencies,
			exports: assembler.exports,
			ims: assembler.ims.map(({ id, hash }) => ({ id, hash })),
			...(styles ? { styles: true } : {}),
			...(widget.specs ? { widget: widget.specs } : {})
		};
	}
}
