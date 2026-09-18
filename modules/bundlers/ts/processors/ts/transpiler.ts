import type { DynamicFile } from '@beyond-js/file/dynamic';
import type { ProcessorOutput } from '@beyond-js/packages/sdk';
import * as ts from 'typescript';

/**
 * Transpiles one TypeScript source file into the body of a runtime internal module.
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
 * Each file is transpiled on its own: this is a syntactic transformation with per-file source maps, and it
 * performs no type checking. Declarations and diagnostics that need the whole program belong to the types
 * pipeline.
 */
export class Transpiler {
	static process(input: DynamicFile, output: ProcessorOutput): void {
		const compilerOptions: ts.CompilerOptions = {
			module: ts.ModuleKind.CommonJS,
			target: ts.ScriptTarget.ES2022,
			jsx: ts.JsxEmit.React,
			sourceMap: true,
			inlineSources: false,
			esModuleInterop: false,
			importHelpers: false,
			// Each file is transformed independently, without reading the rest of the program
			isolatedModules: true,
			verbatimModuleSyntax: false
		};

		// The name the source map refers to: the file relative to the module, as the artifact reports it
		const fileName = input.relative.file.replace(/\\/g, '/');

		try {
			const result = ts.transpileModule(input.content, { compilerOptions, fileName, reportDiagnostics: true });

			const diagnostics = result.diagnostics ?? [];
			if (diagnostics.length) {
				// A file that could not be transformed produces no code: its module is reported, not published
				diagnostics.forEach(diagnostic => {
					const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
					const position = (() => {
						if (!diagnostic.file || diagnostic.start === void 0) return;
						const { line, character } = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
						return { line: line + 1, column: character + 1 };
					})();
					output.issues.push('errors', { code: 'TRANSPILE_ERROR', message, position });
				});
				return;
			}

			// The map is kept as a separate output; the reference comment appended by the compiler is removed
			const code = result.outputText.replace(/\n\/\/# sourceMappingURL=.*$/, '');
			output.code.set({ code, map: result.sourceMapText });
		} catch (error) {
			output.issues.push('errors', { code: 'TRANSPILE_ERROR', message: error.message });
		}
	}
}
