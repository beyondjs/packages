import * as colors from 'colors';
import type { Node, Registry } from '@beyond-js/packages/dependencies/graph';

interface ITreeParams {
	indent: { prefix: string; level: number };
	node: { last: boolean };
}

export /*bundle*/ const tree = function (node: Node, params?: ITreeParams, output?: { text: string }) {
	params = params || { indent: { prefix: '', level: 0 }, node: { last: false } };
	let { prefix, level } = params.indent;
	const { last } = params.node;

	// Print the current node
	const error = node.error ? ` ERROR [${node.error.message}]`.red : '';
	const processed = !node.processed ? ' NOT PROCESSED'.yellow : '';
	const tags = error + processed;
	const vpkg = `${node.package}@${node.version.resolved}`;

	output = output || { text: '' };
	output.text += (level ? prefix + (last ? '└── ' : '├── ') : '') + vpkg + tags + '\n';

	// Update the prefix and indent level for the children
	prefix += level ? '    ' : ' ';
	level++;

	// Recursively print each child
	[...node.dependencies.values()].forEach((child, index) => {
		const last = index === node.dependencies.size - 1;
		tree(child, { indent: { prefix, level }, node: { last } }, output);
	});

	return output.text;
};

export /*bundle*/ const packages = function (registry: Registry) {
	let output = '';

	registry.packages.forEach(dependency => {
		let versions: string[] = [];
		const { semver, fixed } = dependency.nodes;
		semver.groups.forEach(group => versions.push(`"${group.chosen}"`));
		output += dependency.source.name + ': ' + versions.join(', ') + '\n';
	});

	return output;
};
