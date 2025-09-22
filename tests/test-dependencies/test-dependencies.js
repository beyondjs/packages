const { join } = require('path');
require('colors');

const BEE = require('@beyond-js/bee');
BEE('http://localhost:1110', { inspect: 4000 });

(async () => {
	const { Logger } = await bimport('@beyond-js/packages/logs');
	const { ProvidersSettings } = await bimport('@beyond-js/packages/providers/settings');
	const { Providers } = await bimport('@beyond-js/packages/providers');
	const { DependenciesGraph } = await bimport('@beyond-js/packages/dependencies/graph');
	const printer = await bimport('@beyond-js/packages/dependencies/printer');

	// Process the settings for the `my-package` and the workspace set in the current working directory
	const cwd = process.cwd();
	const options = { workspace: cwd, path: join(cwd, 'my-package') };
	const settings = new ProvidersSettings(options);

	const providers = new Providers(settings);

	console.log(
		'Providers:',
		[...providers.entries()].map(([name, { url }]) => ({ name, url }))
	);

	await Logger.init();

	const dependencies = { style: '0.1.x' };
	// const dependencies = { envify: '^3.4.0' };
	// const dependencies = { react: '18.2.0' };
	// const dependencies = { 18: '0.0.0' };
	const manifest = { name: 'my-testing-package-name', version: '1.0.0', dependencies };
	const graph = new DependenciesGraph({ providers, manifest });

	console.log('\nProcessing dependencies graph...\n'.green, graph.package);
	await graph.process();

	console.log('\nDependencies graph has been processed\n'.green);

	// printer.packages(graph.registry);
	printer.tree(graph);
})().catch(exc => console.error(exc.stack));
