import type { IProcessorDiagnostic } from '@beyond-js/packages/sdk';
import * as ts from 'typescript';

/**
 * `import.meta` in the source of an internal module.
 *
 * A source becomes the body of a `creator(require, exports, hot)` function of an ES module artifact, transpiled as
 * CommonJS, where `import.meta` cannot stay: the analysis of the CommonJS code refuses it, and the artifact's own
 * `import.meta` has no `hot` of the source. Each `import.meta` is therefore replaced with `__beyond_meta`, which the
 * envelope of the internal module declares as the artifact's `import.meta` with the `hot` the runtime gives that
 * creator (`Envelope`): its `url` and `resolve` are the artifact's (the address the module was delivered from, never
 * the directory of the source), and `hot` is the update API of this source while a coordinator of the development
 * runtime applies updates, undefined otherwise (the legacy Kernel, production, a test run).
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
				if (ts.isIdentifier(node) && node.text === Meta.NAME && !Meta.#property(node)) this.#reserved(node);
				return ts.visitEachChild(node, visit, context);
			};
			return source => <ts.SourceFile>ts.visitNode(source, visit);
		};
	}

	/**
	 * Whether an identifier only names a property (`o.__beyond_meta`, `{ __beyond_meta: 1 }`, a class or interface
	 * member), which declares no binding and so cannot collide with the envelope's. A shorthand property
	 * (`{ __beyond_meta }`) reads the binding, so it is not one.
	 */
	static #property(node: ts.Identifier): boolean {
		const { parent } = node;
		if (!parent) return false;
		if ((ts.isPropertyAccessExpression(parent) || ts.isQualifiedName(parent)) && parent.name === node) return true;
		const named = ts.isPropertyAssignment(parent) || ts.isPropertyDeclaration(parent) || ts.isPropertySignature(parent) ||
			ts.isMethodDeclaration(parent) || ts.isMethodSignature(parent) || ts.isGetAccessorDeclaration(parent) ||
			ts.isSetAccessorDeclaration(parent) || ts.isEnumMember(parent);
		return named && (<{ name?: ts.Node }>parent).name === node;
	}

	#reserved(node: ts.Identifier) {
		if (this.#diagnostics.length) return;
		const source = node.getSourceFile();
		const { line, character } = source.getLineAndCharacterOfPosition(node.getStart(source));
		const message = `"${Meta.NAME}" is a name the artifact reserves for import.meta: rename it`;
		this.#diagnostics.push({ code: 'NAME_RESERVED', message, position: { line: line + 1, column: character + 1 } });
	}
}
