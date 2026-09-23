import type { ProcessorOutput } from '@beyond-js/packages/sdk';
import { init, parse } from 'cjs-module-lexer';

/**
 * The lexer is initialised once per process and awaited by every analysis
 */
const ready = init();

/**
 * Reads the transformed code of an internal module to obtain what the assembly of the artifact needs:
 *
 * - The names it exports, which define the public API when the internal module is the entry point of its
 *   public module
 * - The internal modules it re-exports with `export * from`, whose names the entry point also publishes
 * - The bare specifiers it requires, which are the public modules this one depends on, and the stylesheets
 *   it selects (`pkg/sub.css`), which it may only import for their effect
 *
 * The analysis reads the emitted code rather than the original source, so the exported names are the ones
 * the runtime actually produces, including those TypeScript generates. Relative requires address internal
 * modules and are resolved by the runtime, so they are not dependencies of the public module.
 */
export /*bundle*/ class Analyzer {
	/**
	 * Whether a require is a statement of its own, which is what an import for its effect alone compiles to:
	 * a stylesheet (`pkg/sub.css`) is selected that way and binds nothing
	 */
	static #effect(code: string, start: number, end: number): boolean {
		const before = code.slice(0, start).split(/[;\n]/).pop();
		const after = code.slice(end).split(/[;\n]/)[0];
		return !before.trim() && !after.trim();
	}

	static async process(output: ProcessorOutput): Promise<void> {
		await ready;

		const code = output.code.code();
		if (typeof code !== 'string') return;

		const { exports, reexports, dependencies } = output.code;

		try {
			const parsed = parse(code);

			// The interoperability marker is not part of the API of the module
			parsed.exports.filter(name => name !== '__esModule').forEach(name => exports.add(name));

			// A re-export of another public module is a dependency, one of an internal module is composition
			parsed.reexports.forEach(specifier => {
				specifier.startsWith('.') ? reexports.add(specifier) : dependencies.add(specifier);
			});
		} catch (error) {
			output.issues.push('errors', { code: 'ANALYSIS_ERROR', message: error.message });
			return;
		}

		/**
		 * The lexer reports re-exports but not ordinary requires, which are collected here. `beyond_context`
		 * is supplied by the runtime to the creator, so it is not a public dependency either.
		 */
		const requires = /\brequire\(\s*(['"])([^'"\n]+)\1\s*\)/g;
		let match: RegExpExecArray;
		while ((match = requires.exec(code))) {
			const specifier = match[2];
			if (specifier.startsWith('.') || specifier === 'beyond_context') continue;
			if (specifier.endsWith('.css') && !Analyzer.#effect(code, match.index, requires.lastIndex)) {
				const message = `"${specifier}" is a stylesheet: import it for its effect alone (import '${specifier}'), which links it; a stylesheet binds no value`;
				output.issues.push('errors', { code: 'STYLE_BINDING_UNSUPPORTED', message });
				continue;
			}
			dependencies.add(specifier);
		}
	}
}
