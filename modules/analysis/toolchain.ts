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
 */
export /*bundle*/ class Toolchain {
	#compiler?: Compiler;
	#conditions: IAnalysisConditions;
	#format: 'esm' | 'system';

	/**
	 * @param compiler The selected compiler; none is needed to describe a distribution, which is only read
	 */
	constructor(compiler: Compiler | undefined, conditions: IAnalysisConditions, format: 'esm' | 'system') {
		this.#compiler = compiler;
		this.#conditions = conditions;
		this.#format = format;
	}

	/**
	 * The revision of the composition that a declared bundler produces here. It is part of the key of every
	 * composed output, so raise it whenever the assembly of a composed module changes in a way that makes an
	 * output generated before it incompatible: the internal-module envelope, the runtime contract, the
	 * widget registration or the stylesheet relationship.
	 */
	static COMPOSITION = '1';

	/**
	 * The revision of how the public subpaths of an ordinary npm package are delivered: on their own, or as a
	 * carrier and its facades when they share internal files ([Sharing](./pinned/sharing.ts)). It is part of
	 * the key of every output of an npm package, because the plan changes what an output contains without
	 * changing any other input: raise it whenever the plan or the union it compiles changes, so that an output
	 * stored before is never answered for a key it no longer satisfies.
	 */
	static SHARING = '1';

	/**
	 * What transforms an ES module into `System.register`
	 */
	static get system() {
		return { transform: 'typescript', version: ts.version };
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
			return { compiler: { name, version, configuration: Compatibility.digest({ distributed: true }) }, conditions, format: this.#format };
		}

		const options = this.options(opened);
		const { version, assigned, provenance } = this.#compiler.identity;
		const sharing = opened.form === 'npm' ? Toolchain.SHARING : void 0;
		const configuration = { options, assigned, revision: provenance?.revision, sharing, system: this.#format === 'system' ? Toolchain.system : void 0 };
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
		const configuration = Compatibility.digest({ composed: true, bundler: composed.specifier, system });
		const conditions = [platform === 'browser' ? 'web' : platform, environment].filter(Boolean).sort();
		return { compiler: { name: composed.specifier, version: Toolchain.COMPOSITION, configuration }, conditions, format: this.#format };
	}

	/**
	 * A static file is the same for every compiler, condition and format
	 */
	static get copied(): Pick<IKeyInputs, 'compiler' | 'conditions' | 'format'> {
		const compiler = { name: '@beyond-js/packages/generation', version: '1', configuration: Compatibility.digest({ copied: true }) };
		return { compiler, conditions: [], format: 'none' };
	}
}
