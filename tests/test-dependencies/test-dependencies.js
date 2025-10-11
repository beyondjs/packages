const { join } = require('path');
require('colors');

const BEE = require('@beyond-js/bee');
BEE('http://localhost:1110', { inspect: 4000 });

(async () => {
	const { Workspace } = await bimport('@beyond-js/packages/workspace');
	const { Project } = await bimport('@beyond-js/packages/project/local');
	const { Logger } = await bimport('@beyond-js/packages/logs');
	const printer = await bimport('@beyond-js/packages/dependencies/printer');

	await Logger.init();

	const workspace = new Workspace(__dirname);
	const project = new Project(workspace, 'my-package', '1.0.0');
	await project.ready;

	console.log('Project is ready'.green);

	// Process project dependencies
	await project.dependencies.install();

	// const manifest = { name: 'my-testing-package-name', version: '1.0.0', dependencies };
	// const graph = new DependenciesGraph({ providers, manifest });

	// console.log('\nProcessing dependencies graph...\n'.green, graph.package);
	// await graph.process();

	// console.log('\nDependencies graph has been processed\n'.green);

	// // printer.packages(graph.registry);
	// printer.tree(graph);
})().catch(exc => console.error(exc.stack));
