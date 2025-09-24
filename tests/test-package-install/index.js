const { join } = require('path');

const BEE = require('@beyond-js/bee');
BEE('http://localhost:1110', { inspect: 4000 });

(async () => {
	const { ProvidersSettings } = await bimport('@beyond-js/packages/providers/settings');
	const { Providers } = await bimport('@beyond-js/packages/providers');
	const { PackageIdentifier } = await bimport('@beyond-js/packages/package/identifier');
	const { TarballDownloader } = await bimport('@beyond-js/packages/package/installer');
	const { Storage } = await bimport('@beyond-js/packages/persistence/storage');

	await Storage.init();
	console.log('Storage initialized');

	// Process the settings for the package-a and the workspace set in the current working directory
	const cwd = process.cwd();
	const options = { workspace: cwd, path: join(cwd, 'package-a') };
	const settings = new ProvidersSettings(options);

	const providers = new Providers(settings);
	const identifier = new PackageIdentifier({ repository: 'npm', name: 'react', version: '19.1.0' });

	console.log('Installing package on path:', identifier.path);

	const tarball = 'https://registry.npmjs.org/react/-/react-19.1.0.tgz';
	const downloader = new TarballDownloader(providers, identifier, tarball);
	await downloader.download();
	console.log('Package installed successfully:', identifier.path);
})().catch(exc => console.error(exc.stack));
