const { join } = require('path');

const BEE = require('@beyond-js/bee');
BEE('http://localhost:1110', { inspect: 4000 });

(async () => {
	const { RepositoriesSettings } = await bimport('@beyond-js/packages/repositories/settings');
	const { Registries } = await bimport('@beyond-js/packages/repositories/registries');
	const { PackageIdentifier } = await bimport('@beyond-js/packages/package/identifier');
	const { TarballDownloader } = await bimport('@beyond-js/packages/package/installer');
	const { Storage } = await bimport('@beyond-js/packages/persistence/storage');

	await Storage.init();
	console.log('Storage initialized');

	// Process the settings for the package-a and the workspace set in the current working directory
	const cwd = process.cwd();
	const options = { workspace: cwd, path: join(cwd, 'package-a') };
	const settings = new RepositoriesSettings(options);

	const registries = new Registries(settings);
	const identifier = new PackageIdentifier({ repository: 'npm', name: 'react', version: '19.1.0' });

	console.log('Installing package on path:', identifier.path);

	const tarball = 'https://registry.npmjs.org/react/-/react-19.1.0.tgz';
	const downloader = new TarballDownloader(registries, identifier, tarball);
	await downloader.download();
	console.log('Package installed successfully:', identifier.path);
})().catch(exc => console.error(exc.stack));
