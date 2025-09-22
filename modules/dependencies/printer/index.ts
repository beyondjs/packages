import * as colors from 'colors';
import type { Node } from '../graph/node';
import type { Registry } from '../graph/registry';

interface ITreeParams {
	indent: { prefix: ''; level: 0 };
	node: { last: boolean };
}

export /*bundle*/ const tree = function (node: Node, params?: ITreeParams) {
	params = params || { indent: { prefix: '', level: 0 }, node: { last: false } };
	let { prefix, level } = params.indent;
	const { last } = params.node;

	// Print the current node
	const error = node.error ? ` ERROR [${node.error.text}]`.red : '';
	const processed = !node.processed ? ' NOT PROCESSED'.yellow : '';
	const tags = error + processed;
	const vpkg = `${node.package}@${node.version.resolved}`;

	console.log((level ? prefix + (last ? '└── ' : '├── ') : '') + vpkg + tags);

	// Update the prefix and indent level for the children
	prefix += level ? '    ' : ' ';
	level++;

	// Recursively print each child
	[...node.dependencies.values()].forEach((child, index) => {
		const last = index === node.dependencies.size - 1;
		this.tree(child, { indent: { prefix, level }, node: { last } });
	});
};

export /*bundle*/ const packages = function (registry: Registry) {
	registry.packages.forEach(dependency => {
		let versions: string[] = [];
		dependency.nodes.groups.forEach(group => versions.push(`"${group.chosen}"`));
		console.log(dependency.info.package + ': ' + versions.join(', '));
	});
};
