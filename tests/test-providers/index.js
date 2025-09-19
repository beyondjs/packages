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

	console.log('');

	// Get versions directly from the 'semver' provider
	const versions = await (async () => {
		console.log(`Getting versions for package: ${pkg} directly from 'semver' provider`.green);
		const { error, versions } = await semver.versions(pkg);

		if (error) {
			console.error(`Error fetching versions for package "${pkg}":`, error);
		} else {
			console.log(`Versions for package "${pkg}":`, versions);
		}

		return versions;
	})();
	if (!versions) return;

	console.log('\n--\n');

	// Get manifest for one of the versions directly from the 'semver' provider
	await (async () => {
		const version = versions[0];
		console.log(`Getting manifest for package "${pkg}@${version}" directly from 'semver' provider`.green);
		const dependency = new DependencyInfo(pkg, '0.0.0');
		const { error, manifest } = await semver.manifest(dependency, version);

		if (error) {
			console.error(`Error fetching manifest for package "${pkg}" version "${version}":`, error);
			return;
		} else {
			console.log(`Manifest for package "${pkg}" version "${version}" was found:`, manifest);
		}
	})();

	console.log('\n--\n');

	// Get versions from the providers manager
	await (async () => {
		console.log(`Getting versions for package: ${pkg} from providers manager`.green);
		const dependency = new DependencyInfo(pkg, '0.0.0');
		const { error, versions } = await providers.versions(dependency);

		if (error) {
			console.error(`Error fetching versions for package "${pkg}":`, error);
		} else {
			console.log(`Versions for package "${pkg}":`, versions);
		}

		return versions;
	})();
})().catch(exc => console.error(exc.stack));
