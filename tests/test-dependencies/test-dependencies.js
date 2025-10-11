const { join } = require('path');
require('colors');

const BEE = require('@beyond-js/bee');
BEE('http://localhost:1110', { inspect: 4000 });

(async () => {
	const { Workspace } = await bimport('@beyond-js/packages/workspace');
	const { Project } = await bimport('@beyond-js/packages/project/local');
	const { Logger } = await bimport('@beyond-js/packages/logs');

	await Logger.init();

	const workspace = new Workspace(__dirname);
	const project = new Project(workspace, 'my-package', '1.0.0');
	await project.ready;

	console.log('Project is ready'.green);

	// Process project dependencies
	console.log('\nProcessing dependencies graph:'.green, project.vname.bold.green);
	await project.dependencies.install();

	console.log('\nDependencies graph has been processed'.green);
	console.log('Dependencies tree:\n'.green);
	console.log(project.dependencies.print.tree);
})().catch(exc => console.error(exc.stack));
