import type { IDiagnostic, ExportsType } from '@beyond-js/packages/types';
import { ModuleSpec } from '@beyond-js/packages/module/spec';

/**
 * The entries a package manifest publishes, normalized to one target per subpath.
 *
 * The supported subset of the `exports` field is deliberately small, and what falls outside it is reported
 * instead of guessed:
 *
 * - An object of subpaths (`"./message"`, `"."`) is taken as it is.
 * - A string is the shorthand of the root entry, as in Node: `"exports": "./index.ts"` publishes `"."`.
 * - Without `exports`, a `main` that points to a source file publishes the root entry. When `exports` is
 *   present it defines everything the package publishes, and an omitted root is not restored from `main`.
 * - Root conditions (`{"import": …}`), fallback arrays and subpath patterns (`"./*"`) are not supported.
 *
 * Whether a target is a source entry point, and therefore a Beyond public module, is decided later from
 * the target itself; this object only establishes which subpaths exist.
 */
export class Entries extends Map<string, ExportsType> {
	#errors: IDiagnostic[] = [];
	get errors() {
		return this.#errors;
	}

	#warnings: IDiagnostic[] = [];
	get warnings() {
		return this.#warnings;
	}

	/**
	 * @param exports The value of the `exports` field, whatever its shape
	 * @param main The value of the `main` field
	 */
	constructor(exports: unknown, main: unknown) {
		super();

		if (exports === void 0 || exports === null) this.#main(main);
		else if (typeof exports === 'string') this.set('.', exports);
		else if (exports instanceof Array) this.#unsupported('fallback arrays', 'Declare one target per subpath');
		else if (typeof exports === 'object') this.#subpaths(<Record<string, ExportsType>>exports);
		else this.#errors.push({ code: 'EXPORTS_INVALID', message: '"exports" must be a string or an object of subpaths' });
	}

	#unsupported(what: string, hint: string): void {
		const code = 'EXPORTS_UNSUPPORTED';
		this.#errors.push({ code, message: `The package "exports" uses ${what}, which are not supported. ${hint}` });
	}

	#main(main: unknown): void {
		if (typeof main !== 'string' || !main) return;

		const target = main.startsWith('.') ? main : `./${main}`;
		if (ModuleSpec.entry(target)) {
			this.set('.', target);
			return;
		}

		const code = 'MAIN_NOT_SOURCE';
		const message =
			`The package "main" ("${main}") is not a source file, so it does not publish a root public module. ` +
			`Point it to the source entry point, or declare the root in "exports"`;
		this.#warnings.push({ code, message });
	}

	#subpaths(exports: Record<string, ExportsType>): void {
		const keys = Object.keys(exports);
		const conditions = keys.filter(key => !key.startsWith('.'));
		if (conditions.length) {
			const hint = `Declare subpaths instead, for example {".": "./index.ts"} (found: ${conditions.join(', ')})`;
			this.#unsupported('root conditions', hint);
			return;
		}

		keys.forEach(subpath => {
			if (subpath.includes('*')) {
				this.#unsupported(`the subpath pattern "${subpath}"`, 'Declare each public module explicitly');
				return;
			}

			// A null target is how a manifest keeps a subpath private
			exports[subpath] !== null && this.set(subpath, exports[subpath]);
		});
	}
}
