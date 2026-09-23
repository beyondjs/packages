import type { IDiagnostic } from '@beyond-js/packages/types';
import * as ts from 'typescript';
import { SourceMapConsumer, SourceMapGenerator } from 'source-map';

/**
 * Turns the native ES module the compiler produced into a `System.register` module.
 *
 * The compiler has no SystemJS output, and its ES module is already the single bundled unit of one public
 * module, so the conversion is a module-format transformation of that one file and nothing is compiled
 * again. It is done by the TypeScript emitter, whose System output is deterministic and keeps what the
 * format must keep: every bare import becomes a named dependency of `System.register`, exported bindings
 * stay live (`exports_1` is called on every assignment), `export *` is forwarded, `import()` becomes
 * `context.import()` and `import.meta` becomes `context.meta`. The source map of the step is composed with
 * the one of the compiler, so the final map still names the original sources.
 */
export /*bundle*/ class SystemFormat {
	/**
	 * Follows every position of the transformed code through the map of the step into the map of the
	 * compiler. The wrapper the step adds comes from no source, so it is left unmapped.
	 */
	#compose(step: string, original: string): string {
		const compiled = new SourceMapConsumer(JSON.parse(original));
		const composed = new SourceMapGenerator({ file: 'out.js' });

		new SourceMapConsumer(JSON.parse(step)).eachMapping(mapping => {
			if (mapping.originalLine === null) return;
			const { source, line, column, name } = compiled.originalPositionFor({ line: mapping.originalLine, column: mapping.originalColumn });
			if (source === null || line === null) return;
			composed.addMapping({ generated: { line: mapping.generatedLine, column: mapping.generatedColumn }, original: { line, column }, source, name: name ?? void 0 });
		});

		compiled.sources.forEach(source => {
			const content = compiled.sourceContentFor(source, true);
			content && composed.setSourceContent(source, content);
		});
		return composed.toString();
	}

	/**
	 * @param code The ES module
	 * @param map Its external source map
	 */
	transform(code: string, map?: string): { code?: string; map?: string; diagnostics: IDiagnostic[] } {
		const result = ts.transpileModule(code, {
			fileName: 'out.js',
			reportDiagnostics: true,
			compilerOptions: {
				module: ts.ModuleKind.System,
				// A module without imports or exports (a side-effect-only module) is still a module: detected as
				// a script it would be emitted without `System.register`, which a SystemJS loader refuses
				moduleDetection: ts.ModuleDetectionKind.Force,
				target: ts.ScriptTarget.ES2022,
				allowJs: true,
				sourceMap: !!map,
				removeComments: false,
				newLine: ts.NewLineKind.LineFeed
			}
		});

		const diagnostics = (result.diagnostics ?? []).map(({ messageText }) => {
			return { code: 'SYSTEM_TRANSFORM_ERROR', message: ts.flattenDiagnosticMessageText(messageText, '\n') };
		});
		if (diagnostics.length) return { diagnostics };

		const output = result.outputText.replace(/\n\/\/# sourceMappingURL=.*\s*$/, '\n');
		return { code: output, map: map ? this.#compose(result.sourceMapText, map) : void 0, diagnostics };
	}
}
