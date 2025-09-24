require('colors');
const { join } = require('path');

const BEE = require('@beyond-js/bee');
BEE('http://localhost:1110', { inspect: 4000 });

(async () => {
	const { ProvidersSettings } = await bimport('@beyond-js/packages/providers/settings');
	const { Providers } = await bimport('@beyond-js/packages/providers');
	const { DependencyInfo } = await bimport('@beyond-js/packages/dependencies/info');

	// Process the settings for the `my-package` and the workspace set in the current working directory
	const cwd = process.cwd();
	const options = { workspace: cwd, path: join(cwd, 'my-package') };
	const settings = new ProvidersSettings(options);

	const providers = new Providers(settings);

	console.log(
		'Providers:'.green,
		[...providers.entries()].map(([name, { url }]) => ({ name, url }))
	);

	const { semver } = providers;
	const pkg = '18';
	const version = '0.0.0';

	console.log('');

	// Get manifest for one of the versions directly from the 'semver' provider
	await (async () => {
		console.log(`Getting manifest for package "${pkg}@${version}" directly from 'semver' provider`.green);
		const dependency = new DependencyInfo(pkg, version);
		const { error, manifest } = await semver.manifest(dependency, version);

		if (error) {
			console.error(`Error fetching manifest for package "${pkg}" version "${version}":`, error);
			return;
		} else {
			console.log(`Manifest for package "${pkg}" version "${version}" was found:`, manifest);
		}
	})();
})().catch(exc => console.error(exc.stack));
