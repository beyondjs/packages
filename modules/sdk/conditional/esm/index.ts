import type { IDiagnostic } from '@beyond-js/packages/types';
import type { ProcessorOutput } from '../processor/outputs/output';
import { Conditional } from '../main';
import { ConditionalOutput } from '@beyond-js/packages/module/output';
import { equal } from '@beyond-js/equal/main';
import { Assembler } from './assembler';

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
	 * The public bare specifiers its internal modules require
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
 * Two outputs are produced from the same internal modules:
 *
 * - `output`, the artifact that creates the runtime package and initialises it
 * - `patch`, the update that addresses the package already loaded under the same identity and replaces
 *   only the internal modules whose hash changed
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

	get valid(): boolean {
		return !this.#errors.length && super.valid;
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

	/**
	 * Collects the internal modules emitted by the processors of this conditional, together with the issues
	 * they reported. A source whose transformation failed produces diagnostics and no code, which invalidates
	 * the whole artifact: a public module is not published while one of its internal modules is missing.
	 */
	#collect(errors: IDiagnostic[]): IInternalModule[] {
		const ims: IInternalModule[] = [];

		this.processors.forEach(processor => {
			if (!processor.valid) {
				processor.errors.forEach(error => errors.push(error));
				return;
			}

			processor.outputs?.ims.forEach(im => {
				const file = im.source.relative.file;

				im.issues.errors.forEach(({ code, message, position }) => {
					const at = position ? ` (${position.line}:${position.column})` : '';
					errors.push({ code, message: `${file}${at}: ${message}` });
				});

				const code = im.code.code();
				if (typeof code !== 'string') return;

				ims.push({ id: ESMConditional.id(file), hash: ESMConditional.hash(code), output: im });
			});
		});

		return ims;
	}

	_process(): boolean {
		const done = (updated: {
			errors?: IDiagnostic[];
			output?: ConditionalOutput;
			patch?: ConditionalOutput;
			artifact?: IESMArtifact;
		}): boolean => {
			const errors = updated.errors ?? [];

			/**
			 * The artifact hash identifies the emitted code, so reprocessing that produces the same code is
			 * not reported as a change: consumers and update services are only notified of real differences.
			 */
			const previous = { errors: this.#errors, hash: this.#output?.hash };
			const changed = !equal(previous, { errors, hash: updated.output?.hash });

			this.#errors = errors;
			this.#output = updated.output;
			this.#patch = updated.patch;
			this.#artifact = updated.artifact;
			return changed;
		};

		const errors: IDiagnostic[] = [];
		const ims = this.#collect(errors);
		if (errors.length) return done({ errors });

		// The entry point is the source file that the package exports declare for this module
		const { module } = this;
		const entry = module.spec.entry;
		if (!entry) {
			const code = 'MODULE_ENTRY_MISSING';
			const message = `Module "${module.spec.subpath}" does not define its entry point`;
			return done({ errors: [{ code, message }] });
		}

		const id = ESMConditional.id(entry);
		if (!ims.some(im => im.id === id)) {
			const code = 'MODULE_ENTRY_NOT_FOUND';
			const message = `Entry point "${entry}" of module "${module.spec.subpath}" was not processed`;
			return done({ errors: [{ code, message }] });
		}

		const { package: pkg } = module;
		const subpath = module.spec.subpath.replace(/^\.\/?/, '');
		const vspecifier = subpath ? `${pkg.vname}/${subpath}` : pkg.vname;

		const assembler = new Assembler({ vspecifier, entry: id, ims });
		if (assembler.errors.length) return done({ errors: assembler.errors });

		const output = new ConditionalOutput();
		output.set(assembler.assemble({ hmr: false }));

		const patch = new ConditionalOutput();
		patch.set(assembler.assemble({ hmr: true }));

		const artifact: IESMArtifact = {
			vspecifier,
			dependencies: assembler.dependencies,
			exports: assembler.exports,
			ims: assembler.ims.map(({ id, hash }) => ({ id, hash }))
		};

		return done({ output, patch, artifact });
	}
}
