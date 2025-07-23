const { join } = require('path');

const BEE = require('@beyond-js/bee');
BEE('http://localhost:3000', { inspect: 4000 });

(async () => {
	const { RepositoriesSettings } = await bimport('@beyond-js/packages/repositories/settings');

	// Process the settings for the package-a and the workspace set in the current working directory
	const cwd = process.cwd();
	const options = { workspace: cwd, path: join(cwd, 'package-a') };
	const settings = new RepositoriesSettings(options);

	await settings.load();
	console.log('Scopes:', [...settings.scopes.entries()]);
	console.log('Hosts:', [...settings.hosts.entries()]);
	console.log('Default repository:', settings.default);
})().catch(exc => console.error(exc.stack));
