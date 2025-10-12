const { join } = require('path');
require('colors');

const BEE = require('@beyond-js/bee');
BEE('http://localhost:1110', { inspect: 4000 });

(async () => {
	const { db } = await bimport('@beyond-js/packages/persistence/db');
	const { Workspace } = await bimport('@beyond-js/packages/workspace');
	const { Project } = await bimport('@beyond-js/packages/project/local');
	const { Logger } = await bimport('@beyond-js/packages/logs');

	await db.init({ cdn: false });
	await Logger.init();

	const workspace = new Workspace(__dirname);
	const project = new Project(workspace, 'my-package', '1.0.0');
	await project.ready;

	console.log('Project is ready'.green);

	// Process project dependencies
	console.log('\nProcessing dependencies graph:'.green, project.vname.bold.green);
	await project.dependencies.install();

	console.log('\nDependencies graph has been processed'.green);
	console.log('\nDependencies tree:'.green);
	console.log(project.dependencies.print.tree);
})().catch(exc => console.error(exc.stack));
