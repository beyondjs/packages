const { join } = require('path');

const BEE = require('@beyond-js/bee');
BEE('http://localhost:3000', { inspect: 4000 });

(async () => {
	const { RepositoriesSettings } = await bimport('@beyond-js/packages/repositories/settings');
	const { Registries } = await bimport('@beyond-js/packages/repositories/registries');

	// Process the settings for the package-a and the workspace set in the current working directory
	const cwd = process.cwd();
	const options = { workspace: cwd, path: join(cwd, 'package-a') };
	const settings = new RepositoriesSettings(options);

	const registries = new Registries(settings);

	console.log(
		'Registries:',
		[...registries.entries()].map(([name, { url }]) => ({ name, url }))
	);

	const { npm } = registries;
	const pkg = { name: '18', versions: void 0, version: void 0, spec: void 0 };
	pkg.versions = await npm.versions(pkg.name);

	if (pkg.versions.error) {
		console.error(`Error fetching versions for package "${pkg.name}":`, pkg.versions.error);
	} else {
		console.log(`Versions for package "${pkg.name}":`, pkg.versions.data);
	}

	pkg.version = pkg.versions.data[0];
	console.log(`Latest version for package "${pkg.name}":`, pkg.version);
	pkg.spec = await npm.spec(pkg.name, pkg.version);

	if (pkg.spec.error) {
		console.error(`Error fetching spec for package "${pkg.name}" version "${pkg.version}":`, pkg.spec.error);
		return;
	} else {
		console.log(`Spec for package "${pkg.name}" version "${pkg.version}" was found:`, pkg.spec.data.found);
	}
})().catch(exc => console.error(exc.stack));
