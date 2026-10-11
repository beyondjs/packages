import { Bundle, type Compiler } from '@beyond-js/packages/bundlers/esbuild/processors/bundle';
import * as ts from 'typescript';
import type { IAnalysisConditions, IKeyInputs } from './types';
import type { Opened } from './pinned/opened';
import { NpmPackage } from './pinned/npm';
import { Compatibility } from './compatibility';

/**
 * What produces the outputs of one package for one set of conditions and one format, described the way the
 * compatibility key needs it: a name, a version and the digest of everything else that changes the output.
 *
 * For a compiled form that is the selected compiler, whether it is the Beyond fork and at which revision,
 * the options it runs with and, for `system`, the transformation that follows. Where the compiler is
 * installed and how it was named are not part of it. A distribution is described by what its declaration
 * says compiled it, and a static file by the fact that it is copied.
 *
 * A module composed by a bundler of its own package is described by that bundler and by the revision of the
 * composition this implementation produces, because the selected compiler never ran for it.
 *
 * A confined compilation is part of every configuration it describes (`confined: true`): an output prepared
 * confined never stands for one prepared without it, which may have run code or read files that confinement
 * refuses. An unconfined description is unchanged by it.
 */
export /*bundle*/ class Toolchain {
	#compiler?: Compiler;
	#conditions: IAnalysisConditions;
	#format: 'esm' | 'system';
	#confined: boolean;

	/**
	 * @param compiler The selected compiler; none is needed to describe a distribution, which is only read
	 * @param confined Whether the packages are compiled confined
	 */
	constructor(compiler: Compiler | undefined, conditions: IAnalysisConditions, format: 'esm' | 'system', confined = false) {
		this.#compiler = compiler;
		this.#conditions = conditions;
		this.#format = format;
		this.#confined = confined === true;
	}

	/**
	 * What a confined compilation adds to a configuration: nothing when the compilation is not confined
	 */
	get #confinement(): { confined?: true } {
		return this.#confined ? { confined: true } : {};
	}

	/**
	 * The revision of the composition that a declared bundler produces here. It is part of the key of every
	 * composed output, so raise it whenever the assembly of a composed module changes in a way that makes an
	 * output generated before it incompatible: the internal-module envelope, the runtime contract, the
	 * widget registration or the stylesheet relationship. It is also the only record of the compilers the
	 * processors run with (Svelte, Vue, Sass, Tailwind, TypeScript): upgrading one that changes what it emits
	 * must raise it too.
	 *
	 * `2`: the scope a Vue or Svelte component gives its styles is derived from the identity of its source
	 * ([Scope](../sdk/conditional/processor/scope.ts)) instead of a path, so an output composed before it
	 * does not select the classes or attributes one composed after it writes.
	 *
	 * `3`: a stylesheet the sources select (`pkg/sub.css`) is a style relation, named by the specification of
	 * the bundle and never imported, where an output composed before imported it as a module; and a widget
	 * whose package publishes `./global` relates to that sheet.
	 */
	static COMPOSITION = '3';

	/**
	 * The revision of how the public subpaths of an ordinary npm package are delivered: on their own, or as a
	 * carrier and its facades when they share internal files ([Sharing](./pinned/sharing.ts)). It is part of
	 * the key of every output of an npm package, because the plan changes what an output contains without
	 * changing any other input: raise it whenever the plan or the union it compiles changes, so that an output
	 * stored before is never answered for a key it no longer satisfies.
	 */
	static SHARING = '1';

	/**
	 * What transforms an ES module into `System.register`. `revision` is raised whenever the transformation
	 * changes what it emits for the same input: revision 2 registers a module without imports or exports
	 * instead of emitting it as a plain script.
	 */
	static get system() {
		return { transform: 'typescript', version: ts.version, revision: '2' };
	}

	/**
	 * The options the compiler runs with for the modules of a package
	 */
	options(opened: Opened) {
		const { platform, environment } = this.#conditions;
		const settings = opened.form === 'npm' ? NpmPackage.settings(this.#conditions) : {};
		return Bundle.configuration(Object.assign({ platform, environment, minify: environment === 'production' }, settings));
	}

	/**
	 * The `compiler`, `conditions` and `format` inputs of the outputs of a package
	 */
	describe(opened: Opened, composed?: { name: string; specifier: string }): Pick<IKeyInputs, 'compiler' | 'conditions' | 'format'> {
		const { platform, environment } = this.#conditions;
		if (composed) return this.#composed(composed);
		if (opened.form === 'distribution') {
			const { name, version } = opened.publication.compiler;
			const conditions = [platform, environment].filter(Boolean).sort();
			return { compiler: { name, version, configuration: Compatibility.digest({ distributed: true, ...this.#confinement }) }, conditions, format: this.#format };
		}

		const options = this.options(opened);
		const { version, assigned, provenance } = this.#compiler.identity;
		const sharing = opened.form === 'npm' ? Toolchain.SHARING : void 0;
		const configuration = { options, assigned, revision: provenance?.revision, sharing, system: this.#format === 'system' ? Toolchain.system : void 0, ...this.#confinement };
		const conditions = [...new Set([options.platform, ...options.conditions])].sort();
		return { compiler: { name: 'esbuild', version, configuration: Compatibility.digest(configuration) }, conditions, format: this.#format };
	}

	/**
	 * A module composed by the bundler its package declares: what produced it is that bundler, with the
	 * revision of the composition, and never the compiler the consumer selected
	 */
	#composed(composed: { name: string; specifier: string }): Pick<IKeyInputs, 'compiler' | 'conditions' | 'format'> {
		const { platform, environment } = this.#conditions;
		const system = this.#format === 'system' ? Toolchain.system : void 0;
		const configuration = Compatibility.digest({ composed: true, bundler: composed.specifier, system, ...this.#confinement });
		const conditions = [platform === 'browser' ? 'web' : platform, environment].filter(Boolean).sort();
		return { compiler: { name: composed.specifier, version: Toolchain.COMPOSITION, configuration }, conditions, format: this.#format };
	}

	/**
	 * A static file is the same for every compiler, condition and format
	 */
	static get copied(): Pick<IKeyInputs, 'compiler' | 'conditions' | 'format'> {
		return Toolchain.copy();
	}

	/**
	 * How a static file is described: copied, and read confined when the packages are compiled confined
	 */
	static copy(confined = false): Pick<IKeyInputs, 'compiler' | 'conditions' | 'format'> {
		const configuration = Compatibility.digest(confined ? { copied: true, confined: true } : { copied: true });
		const compiler = { name: '@beyond-js/packages/generation', version: '1', configuration };
		return { compiler, conditions: [], format: 'none' };
	}
}
