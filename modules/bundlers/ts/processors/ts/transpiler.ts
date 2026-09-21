import type { DynamicFile } from '@beyond-js/file/dynamic';
import type { ProcessorOutput, IProcessorDiagnostic } from '@beyond-js/packages/sdk';
import * as ts from 'typescript';

/**
 * A source to transform: its content and the name the source map refers to
 */
export /*bundle*/ interface ITranspileSource {
	/**
	 * The file relative to the module, with forward slashes, as the artifact reports it
	 */
	file: string;
	content: string;

	/**
	 * `js` for a source that is already JavaScript, such as the output of a framework compiler, which is
	 * then only converted to the CommonJS shape of an internal module. `ts` is the default.
	 */
	kind?: 'ts' | 'tsx' | 'js';
}

export /*bundle*/ interface ITranspiled {
	code?: string;
	map?: string;
	diagnostics: IProcessorDiagnostic[];
}

/**
 * Transpiles one TypeScript source into the body of a runtime internal module.
 *
 * The output is CommonJS, not ES module syntax, because a source file of a public module does not become a
 * separate ES module at runtime: it becomes a `creator(require, exports)` function that the runtime
 * evaluates on demand. `require` and `exports` are the parameters of that function, so the transformation
 * that targets them is the CommonJS one.
 *
 * The exports must be written as assignments on the `exports` object. The runtime empties and refills that
 * object when it re-creates an internal module after an update, which is only possible while its properties
 * are configurable. Emitters that define exports as accessors, instead of assigning them, produce internal
 * modules that cannot be updated. TypeScript emits accessors only for `export ... from` re-exports, which
 * is why a module whose public API changes shape through re-exports is reloaded rather than updated.
 *
 * Each source is transpiled on its own: this is a syntactic transformation with per-source maps, and it
 * performs no type checking. Declarations and diagnostics that need the whole program belong to the types
 * conditional. Framework processors reuse `transform` for the scripts and templates they generate.
 */
export /*bundle*/ class Transpiler {
	static #options(kind: ITranspileSource['kind']): ts.CompilerOptions {
		return {
			module: ts.ModuleKind.CommonJS,
			target: ts.ScriptTarget.ES2022,
			jsx: ts.JsxEmit.React,
			sourceMap: true,
			inlineSources: false,
			esModuleInterop: false,
			importHelpers: false,
			allowJs: kind === 'js',
			// Each file is transformed independently, without reading the rest of the program
			isolatedModules: true,
			verbatimModuleSyntax: false
		};
	}

	/**
	 * Transforms a source and reports what could not be transformed
	 */
	static transform({ file, content, kind = 'ts' }: ITranspileSource): ITranspiled {
		const fileName = file.replace(/\\/g, '/');
		const diagnostics: IProcessorDiagnostic[] = [];

		try {
			const compilerOptions = Transpiler.#options(kind);
			const result = ts.transpileModule(content, { compilerOptions, fileName, reportDiagnostics: true });

			(result.diagnostics ?? []).forEach(diagnostic => {
				const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
				const position = (() => {
					if (!diagnostic.file || diagnostic.start === void 0) return;
					const { line, character } = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
					return { line: line + 1, column: character + 1 };
				})();
				diagnostics.push({ code: 'TRANSPILE_ERROR', message, position });
			});
			// A source that could not be transformed produces no code: its module is reported, not published
			if (diagnostics.length) return { diagnostics };

			// The map is kept as a separate output; the reference comment appended by the compiler is removed
			const code = result.outputText.replace(/\n\/\/# sourceMappingURL=.*$/, '');
			return { code, map: result.sourceMapText, diagnostics };
		} catch (error) {
			return { diagnostics: [{ code: 'TRANSPILE_ERROR', message: error.message }] };
		}
	}

	/**
	 * Transforms a source file of the module into the output of its internal module
	 */
	static process(input: DynamicFile, output: ProcessorOutput): void {
		const kind = input.file.endsWith('.tsx') ? 'tsx' : 'ts';
		const { code, map, diagnostics } = Transpiler.transform({ file: input.relative.file, content: input.content, kind });
		diagnostics.forEach(diagnostic => output.issues.push('errors', diagnostic));
		typeof code === 'string' && output.code.set({ code, map });
	}
}
