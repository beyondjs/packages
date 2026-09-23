import type { Package } from '@beyond-js/packages/package';
import type { BaseModule } from '@beyond-js/packages/module';
import type { IDiagnostic } from '@beyond-js/packages/types';
import type { ESMConditional } from '@beyond-js/packages/sdk';
import type { ConditionalOutput } from '@beyond-js/packages/module/output';
import type { IArtifactDependency } from './types';
import type { Conditions } from '@beyond-js/packages/module';
import type { Dependencies } from './dependencies';

/**
 * The compilation of one public module for the requested conditions.
 *
 * A compilation is valid only when the module produced its output and every public dependency of that
 * output can be satisfied. An artifact whose dependencies are undeclared, incompatible or missing is as
 * unusable as one that did not compile, so both are the same outcome for whoever writes or serves it:
 * diagnostics, and no code to publish.
 */
export /*bundle*/ class Compilation {
	#pkg: Package;
	get package() {
		return this.#pkg;
	}

	#subpath: string;
	get subpath() {
		return this.#subpath;
	}

	#module: BaseModule;
	#conditions: Conditions;
	#dependencies: Dependencies;

	/**
	 * The public specifier of the module, for example `@suite/shared/message`, or the package name for its
	 * root module
	 */
	get specifier(): string {
		const { name } = this.#pkg;
		return this.#subpath === '.' ? name : `${name}/${this.#subpath.replace(/^\.\//, '')}`;
	}

	#errors: IDiagnostic[] = [];
	get errors() {
		return this.#errors;
	}

	get valid() {
		return !!this.#conditional && !this.#errors.length;
	}

	#conditional: ESMConditional;

	/**
	 * The compiled conditional, available when the compilation is valid
	 */
	get conditional() {
		return this.valid ? this.#conditional : void 0;
	}

	#styles: ConditionalOutput;

	/**
	 * The stylesheet of the module, when it built one. A style module builds a stylesheet and no code: its
	 * compilation is not `valid` (there is no code to publish, `OUTPUT_NOT_FOUND`) and its stylesheet is here.
	 */
	get styles(): ConditionalOutput | undefined {
		return this.valid ? this.#conditional.styles : this.#styles;
	}

	#key: string;

	/**
	 * The key of the conditional that satisfied the requested conditions, such as `web` or `web/production`
	 */
	get key() {
		return this.#key;
	}

	#resolved: IArtifactDependency[] = [];

	/**
	 * How each public dependency of the output is satisfied
	 */
	get dependencies() {
		return this.#resolved;
	}

	constructor(pkg: Package, subpath: string, conditions: Conditions, dependencies: Dependencies) {
		this.#pkg = pkg;
		this.#subpath = subpath;
		this.#module = pkg.modules.get(subpath);
		this.#conditions = conditions;
		this.#dependencies = dependencies;
	}

	/**
	 * Compiles the module and checks its dependencies. It reports diagnostics instead of throwing.
	 */
	async run(): Promise<this> {
		const { specifier } = this;
		const module = this.#module;
		this.#errors = [];
		this.#conditional = void 0;
		this.#styles = void 0;

		await module.conditionals.ready;
		const key = this.#conditions.select(module);
		if (!key) {
			const code = 'CONDITIONAL_NOT_FOUND';
			// What a consumer of code can select is a platform. The `types` conditional is the declaration of
			// the module, and a conditional of an environment (`web/production`) is reached by asking for that
			// environment and not by naming it here, so neither belongs in the list offered to the user
			const declared = [...module.conditionals.keys()].filter(key => key !== 'types' && !key.includes('/')).join(', ');
			const message =
				`Module "${specifier}" does not produce the "${this.#conditions.key}" conditional ` +
				`(declared: ${declared})`;
			this.#errors.push({ code, message });
			return this;
		}

		this.#key = key;
		const conditional = <ESMConditional>module.conditionals.get(key);
		await conditional.ready;
		if (conditional.valid && !conditional.output && conditional.styles) {
			this.#styles = conditional.styles;
			this.#errors.push({ code: 'OUTPUT_NOT_FOUND', message: `Module "${specifier}" is a stylesheet and has no JavaScript output` });
			return this;
		}
		if (!conditional.valid || !conditional.output) {
			const prefix = `Module "${specifier}": `;
			conditional.errors.forEach(error => this.#errors.push({ ...error, message: prefix + error.message }));

			// A conditional is invalid without diagnostics only if one of its producers failed to report one
			!conditional.errors.length &&
				this.#errors.push({ code: 'OUTPUT_MISSING', message: `Module "${specifier}" did not produce its output` });
			return this;
		}

		this.#conditional = conditional;

		// A conditional without an artifact, such as the declaration of a module, imports nothing
		const { dependencies = [], runtime } = conditional.artifact ?? {};
		this.#resolved = await this.#dependencies.resolve(this.#pkg, dependencies, this.#errors, runtime);
		return this;
	}
}
