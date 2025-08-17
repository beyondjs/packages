const BEE = require('@beyond-js/bee');
const { join } = require('path');

BEE('http://localhost:1110', { inspect: 4000 });

(async () => {
	const { WatcherClient } = await bimport('@beyond-js/watchers/client');
	const { Package } = await bimport('@beyond-js/packages/package');

	const path = join(__dirname, 'my-package');
	const pkg = new Package(path);
	await pkg.ready;
	console.log(`Package "${pkg.name}" is ready.\n`);

	await pkg.modules.ready;
	console.log('Modules is valid:', pkg.modules.valid, !pkg.modules.valid ? pkg.modules.errors : '');

	console.log('Process package bundlers');
	await pkg.bundlers.ready;
	console.log('Bundlers is valid:', pkg.bundlers.valid, !pkg.bundlers.valid ? pkg.bundlers.errors : '');
	console.log('Bundlers:', [...pkg.bundlers.keys()]);
	console.log('Default bundler:', pkg.bundlers.get('exports').valid);
})().catch(exc => console.error(exc.stack));
