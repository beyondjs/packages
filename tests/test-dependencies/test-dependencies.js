const { join } = require('path');

const BEE = require('@beyond-js/bee');
BEE('http://localhost:1110', { inspect: 4000 });

(async () => {
	const { Logger } = await bimport('@beyond-js/packages/logs');
	const { RepositoriesSettings } = await bimport('@beyond-js/packages/repositories/settings');
	const { Registries } = await bimport('@beyond-js/packages/repositories/registries');
	const { DependenciesGraph } = await bimport('@beyond-js/packages/dependencies/graph');

	// Process the settings for the `my-package` and the workspace set in the current working directory
	const cwd = process.cwd();
	const options = { workspace: cwd, path: join(cwd, 'my-package') };
	const settings = new RepositoriesSettings(options);

	const registries = new Registries(settings);

	console.log(
		'Registries:',
		[...registries.entries()].map(([name, { url }]) => ({ name, url }))
	);

	await Logger.init();

	const dependencies = { react: '18.2.0' };
	const spec = { name: 'cualquiera', version: '1.0.0', dependencies };
	const graph = new DependenciesGraph({ spec, registries });
	await graph.process();
})().catch(exc => console.error(exc.stack));
