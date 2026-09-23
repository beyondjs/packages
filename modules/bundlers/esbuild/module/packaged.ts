import type { IProcessedSpec } from '@beyond-js/packages/module';
import type { IDiagnostic } from '@beyond-js/packages/types';
import type { IProcessorsSetup, IESMArtifact } from '@beyond-js/packages/sdk';
import { Conditional } from '@beyond-js/packages/sdk';
import { ConditionalOutput } from '@beyond-js/packages/module/output';
import { equal } from '@beyond-js/equal/main';

/**
 * What the bundle processor leaves for its conditional. It is declared here as a structure because the
 * processor is another public module, imported by the collection of processors and not by this file.
 */
interface IBundle {
	code: string;
	map: string;
	css?: string;
	cssmap?: string;
	resources?: { path: string; file: string; via: 'css' | 'js' }[];
	exports: string[];
	stars: string[];
	dependencies: string[];
	references?: { specifier: string; kind: 'eager' | 'lazy' | 'style' }[];
	inputs: string[];
	compiler: IESMArtifact['compiler'];
}

/**
 * The packaged conditional of a public module: one native ES module bundled from its sources.
 *
 * It exposes the same members the artifacts writer and the delivery read from any conditional (`output`,
 * `artifact`, diagnostics), so a packaged module is written, resolved and checked exactly as a composed
 * one. It has no `patch`: there are no internal modules to replace, and how a running consumer receives a
 * rebuilt packaged module is an update integration that this conditional does not implement.
 */
export /*bundle*/ class Packaged extends Conditional {
	#output: ConditionalOutput;

	/**
	 * The code of the module. It is undefined for a style module (`"./theme": "./theme.css"`), whose sources
	 * bundle to a stylesheet and no code: such a conditional is valid and has `styles` only.
	 */
	get output(): ConditionalOutput {
		return this.#output;
	}

	get patch(): ConditionalOutput {
		return void 0;
	}

	#artifact: IESMArtifact;
	get artifact(): IESMArtifact {
		return this.#artifact;
	}

	#styles: ConditionalOutput;

	/**
	 * The stylesheet the sources of the module import, bundled as one separate output. It is undefined for a
	 * module that imports none: styles are never injected into the code.
	 */
	get styles(): ConditionalOutput | undefined {
		return this.#styles;
	}

	#resources: IBundle['resources'] = [];

	/**
	 * The static files the module uses, which its outputs address under `assets/` by their path in the package
	 */
	get resources() {
		return this.#resources;
	}

	#errors: IDiagnostic[] = [];
	get errors(): IDiagnostic[] {
		return this.#errors.concat(super.errors);
	}

	get valid(): boolean {
		return !this.#errors.length && super.valid;
	}

	_spec(values: Record<string, any>): IProcessedSpec {
		return { values };
	}

	_processors(): IProcessorsSetup {
		const specifier = '@beyond-js/packages/bundlers/esbuild/processors/bundle';
		return { processors: new Map([['bundle', { specifier }]]) };
	}

	/**
	 * The outputs of a bundle. A stylesheet entry bundles to a stylesheet and no code, so its `output` is undefined.
	 */
	#outputs(bundle: IBundle): { output?: ConditionalOutput; styles?: ConditionalOutput; artifact: IESMArtifact } {
		const { module } = this;
		const subpath = module.spec.subpath.replace(/^\.\/?/, '');
		const vspecifier = subpath ? `${module.package.vname}/${subpath}` : module.package.vname;

		let output: ConditionalOutput;
		if (typeof bundle.code === 'string') {
			output = new ConditionalOutput();
			output.set({ code: bundle.code, map: bundle.map });
		}
		let styles: ConditionalOutput;
		if (typeof bundle.css === 'string') {
			styles = new ConditionalOutput();
			styles.set({ code: bundle.css, map: bundle.cssmap });
		}
		// The stylesheets its sources select (`pkg/sub.css`) were removed from the code: whoever delivers it links them
		const stylesheets = (bundle.references ?? []).filter(({ kind }) => kind === 'style').map(({ specifier }) => specifier);
		const artifact: IESMArtifact = {
			vspecifier,
			dependencies: bundle.dependencies,
			...(stylesheets.length ? { stylesheets } : {}),
			exports: bundle.exports,
			ims: [],
			composition: 'packaged',
			stars: bundle.stars,
			inputs: bundle.inputs,
			compiler: bundle.compiler
		};
		return { output, styles, artifact };
	}

	_process(): boolean {
		const errors: IDiagnostic[] = [];
		let bundle: IBundle;
		this.processors.forEach(processor => {
			processor.errors.forEach(error => errors.push(error));
			bundle = (<{ bundle?: IBundle }>(<unknown>processor)).bundle ?? bundle;
		});
		!errors.length && !bundle && errors.push({ code: 'OUTPUT_MISSING', message: 'The module was not bundled' });
		!errors.length && typeof bundle.code !== 'string' && typeof bundle.css !== 'string' && errors.push({ code: 'OUTPUT_MISSING', message: 'The bundle produced neither code nor a stylesheet' });

		let output: ConditionalOutput;
		let styles: ConditionalOutput;
		let artifact: IESMArtifact;
		if (!errors.length) {
			// A failure here is a diagnostic of the module: a processing that throws would leave its readiness unsettled
			try {
				({ output, styles, artifact } = this.#outputs(bundle));
			} catch (exc) {
				errors.push({ code: 'OUTPUT_MISSING', message: `The outputs of the bundle could not be read: ${exc instanceof Error ? exc.message : exc}` });
			}
		}

		const previous = { errors: this.#errors, hash: this.#output?.hash, styles: this.#styles?.hash };
		const changed = !equal(previous, { errors, hash: output?.hash, styles: styles?.hash });
		this.#errors = errors;
		this.#output = output;
		this.#styles = styles;
		this.#resources = (!errors.length && bundle.resources) || [];
		this.#artifact = errors.length ? void 0 : artifact;
		return changed;
	}
}
