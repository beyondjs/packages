import type { DynamicFile } from '@beyond-js/file/dynamic';
import type { ProcessorOutput } from '@beyond-js/packages/sdk';
import type { ExportDeclaration, ExportDefaultExpression } from '@swc/core';
import * as swc from '@swc/core';

export class Exports extends Set {
	static async process(input: DynamicFile, output: ProcessorOutput): Promise<void> {
		// Extract exports with magic comment
		const ast = await swc.parse(input.content, { syntax: 'typescript' });

		const bundle = (node: ExportDeclaration | ExportDefaultExpression) => {
			// Actually not supported
			if (node.type === 'ExportDefaultExpression') return false;

			const { declaration } = node;
			if (!declaration) return false;

			// Slice the text between `export` and `const|class|function`
			const start = Math.max(0, node.span.start - 1);
			const end = declaration.span.start - 1; // beginning of the `export` keyword
			const slice = input.content.slice(start, end);

			// Search for the magic comment
			return /\/\*\s*bundle\s*\*\//.test(slice);
		};

		const { exports } = output.code;

		for (const node of ast.body) {
			if (node.type === 'ExportDefaultExpression') {
				bundle(node) && exports.add('default');
			} else if (node.type === 'ExportDeclaration' && node.declaration) {
				if (!bundle(node)) continue;

				const { declaration } = node;
				switch (declaration.type) {
					case 'ClassDeclaration':
					case 'FunctionDeclaration':
						declaration.identifier?.value && exports.add(declaration.identifier.value);
						break;
					case 'VariableDeclaration':
						declaration.declarations.forEach(d => d.id.type === 'Identifier' && exports.add(d.id.value));
						break;
				}
			}
		}
	}
}
