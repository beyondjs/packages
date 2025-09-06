import swc from '@swc/core';

export class Exports extends Set {
	async process(item) {
		// Extract exports with magic comment
		const ast = await swc.parse(item.source.content, {
			syntax: 'typescript',
			sourceType: 'module'
		});

		const bundle = node => {
			const { declaration } = node;
			if (!declaration) return false;

			// Slice the text between `export` and `const|class|function`
			const start = Math.max(0, node.span.start - 1);
			const end = declaration.span.start - 1; // beginning of the `export` keyword
			const slice = item.source.content.slice(start, end);

			// Search for the magic comment
			return /\/\*\s*bundle\s*\*\//.test(slice);
		};

		for (const node of ast.body) {
			if (node.type === 'ExportDefaultExpression') {
				bundle(node) && this.add('default');
			} else if (node.type === 'ExportDeclaration' && node.declaration) {
				if (!bundle(node)) continue;

				const { declaration } = node;
				if (declaration.type === 'ClassDeclaration' || declaration.type === 'FunctionDeclaration') {
					declaration.id?.value && this.add(declaration.id.value);
				} else if (declaration.type === 'VariableDeclaration') {
					declaration.declarations.forEach(d => d.id.type === 'Identifier' && this.add(d.id.value));
				}
			}
		}
	}
}
