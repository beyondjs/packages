import type { IProcessorDiagnostic } from '@beyond-js/packages/sdk';
import * as ts from 'typescript';

/**
 * `import.meta` in the source of an internal module.
 *
 * A source becomes the body of a `creator(require, exports, hot)` function of an ES module artifact, transpiled as
 * CommonJS, where `import.meta` cannot stay: the analysis of the CommonJS code refuses it, and the artifact's own
 * `import.meta` has no `hot` of the source. Each `import.meta` is therefore replaced with `__beyond_meta`, which the
 * envelope of the internal module declares as the artifact's `import.meta` with the `hot` the runtime gives that
 * creator (`Assembler`): its `url` and `resolve` are the artifact's, and `hot` is the update API of this source when the
 * runtime applies updates, undefined otherwise.
 *
 * The name is reserved: a source that writes it itself is refused, because its declaration would collide with the one
 * of the envelope (`NAME_RESERVED`).
 */
export class Meta {
	static NAME = '__beyond_meta';

	#used = false;

	/**
	 * Whether the source wrote `import.meta`, which is what its envelope declares the name for
	 */
	get used() {
		return this.#used;
	}

	#diagnostics: IProcessorDiagnostic[] = [];
	get diagnostics() {
		return this.#diagnostics;
	}

	/**
	 * The transformation that runs before the CommonJS one: `import.meta` becomes the reserved name, kept at the
	 * position of the source, so that its map still points there
	 */
	get transformer(): ts.TransformerFactory<ts.SourceFile> {
		return context => {
			const visit = (node: ts.Node): ts.Node => {
				if (ts.isMetaProperty(node) && node.keywordToken === ts.SyntaxKind.ImportKeyword) {
					this.#used = true;
					return ts.setTextRange(context.factory.createIdentifier(Meta.NAME), node);
				}
				// `text`, not `escapedText`, which TypeScript prefixes with an underscore for a name that starts with two
				if (ts.isIdentifier(node) && node.text === Meta.NAME) this.#reserved(node);
				return ts.visitEachChild(node, visit, context);
			};
			return source => <ts.SourceFile>ts.visitNode(source, visit);
		};
	}

	#reserved(node: ts.Identifier) {
		if (this.#diagnostics.length) return;
		const source = node.getSourceFile();
		const { line, character } = source.getLineAndCharacterOfPosition(node.getStart(source));
		const message = `"${Meta.NAME}" is a name the artifact reserves for import.meta: rename it`;
		this.#diagnostics.push({ code: 'NAME_RESERVED', message, position: { line: line + 1, column: character + 1 } });
	}
}
