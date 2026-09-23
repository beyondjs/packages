import type { IDiagnostic } from '@beyond-js/packages/types';
import type { IAnalysisConditions } from '../types';
import type { Opened, IPublicModule } from './opened';
import { Specifier } from '../specifier';

/**
 * Which public module, and which of its outputs, a specifier imported from a package selects.
 *
 * An import selects the JavaScript output of a public module. An explicit `.css` selects the stylesheet of
 * the public module the specifier names without it — the CSS output of `./sub` for `pkg/sub.css` — unless
 * the package publishes the literal subpath `./sub.css`, which is then that module: npm packages export
 * stylesheets under their file names. When both exist and are different public modules the selection is
 * ambiguous and nothing is guessed. `.js` and `.mjs` state the JavaScript output the same way. No other
 * extension selects an output.
 *
 * A stylesheet has no JavaScript output: importing a style module without `.css` is refused with the
 * specifier to write instead. Whether a module that is not a style module produces a stylesheet is known
 * only once it is compiled, so that case is decided by whoever compiles it.
 */
export /*bundle*/ class Output {
	/**
	 * @param css Selects the stylesheet whatever the spelling: a reference a distribution declares as `style`
	 */
	static async select(opened: Opened, parsed: Specifier, conditions: IAnalysisConditions, css = false): Promise<{ module?: IPublicModule; output: 'js' | 'css'; diagnostics: IDiagnostic[] }> {
		const label = Specifier.of(opened.name, parsed.subpath);
		const output = parsed.extension === 'css' || css ? 'css' : 'js';
		const fail = (code: string, message: string) => ({ output, diagnostics: [{ code, message }] });

		const literal = await opened.module(parsed.subpath, conditions);
		if (!parsed.extension || (css && parsed.extension !== 'css')) {
			if (output === 'js' && literal.module?.kind === 'style') {
				return fail('OUTPUT_NOT_FOUND', `"${label}" is a stylesheet and has no JavaScript output: import "${label}.css" to link it`);
			}
			return { module: literal.module, output, diagnostics: literal.diagnostics };
		}

		const stripped = parsed.stripped ? await opened.module(parsed.stripped, conditions) : void 0;
		const selected = stripped?.module && Specifier.of(opened.name, stripped.module.subpath);
		if (literal.module && stripped?.module && !Output.#same(literal.module, stripped.module)) {
			const message = `"${label}" is ambiguous: package "${opened.key}" publishes both the module "${label}" and "${selected}", whose ${output === 'css' ? 'stylesheet' : 'JavaScript'} it would also select`;
			return fail('OUTPUT_AMBIGUOUS', message);
		}

		const module = literal.module ?? stripped?.module;
		if (!module) {
			const reasons = (stripped ?? literal).diagnostics.map(({ message }) => message).join('; ');
			return fail('OUTPUT_NOT_FOUND', `"${label}" selects no output of package "${opened.key}"${reasons ? `: ${reasons}` : ''}`);
		}
		if (output === 'js' && module.kind === 'style') {
			const name = Specifier.of(opened.name, module.subpath);
			return fail('OUTPUT_NOT_FOUND', `"${label}" selects JavaScript, and "${name}" is a stylesheet: import "${name}.css" to link it`);
		}
		return { module, output, diagnostics: [] };
	}

	/**
	 * Two public modules are the same when they are one subpath or one entry point of one kind
	 */
	static #same(one: IPublicModule, other: IPublicModule): boolean {
		return one.subpath === other.subpath || (!!one.entry && one.entry === other.entry && one.kind === other.kind);
	}
}
