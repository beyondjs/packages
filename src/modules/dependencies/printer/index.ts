import * as colors from 'colors';
import type { DependenciesNode } from '../graph/node';
import type { DependenciesList } from '../graph/list';

module.exports = new (class {
	tree(node: DependenciesNode, prefix = '', isLastChild = true) {
		// Print the current node
		const error = node.error ? ` ERROR [${node.error.text}]`.red : '';
		const processed = !node.processed ? ' NOT PROCESSED'.yellow : '';
		const tags = error + processed;
		const vpkg = `${node.pkg}@${node.version.resolved}`;

		console.log(prefix + (isLastChild ? '└── ' : '├── ') + vpkg + tags);

		// Update the prefix for the children
		prefix += isLastChild ? '    ' : '│   ';

		// Recursively print each child
		[...node.dependencies.values()].forEach((child, index) => {
			const isLast = index === node.dependencies.size - 1;
			this.tree(child, prefix, isLast);
		});
	}

	packages(list: DependenciesList) {
		list.forEach(dependency => {
			let versions: string[] = [];
			dependency.groups.forEach(group => versions.push(`"${group.max}"`));
			console.log(dependency.pkg + ': ' + versions.join(', '));
		});
	}
})();
