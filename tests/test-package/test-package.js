const BEE = require('@beyond-js/bee');
const { join } = require('path');

BEE('http://localhost:1110', { inspect: 4000 });

(async () => {
	const { WatcherClient } = await bimport('@beyond-js/watchers/client');
	const { Package } = await bimport('@beyond-js/packages/package');

	const path = join(__dirname, 'my-package');
	const pkg = new Package(path);
	await pkg.ready;
	await pkg.modules.ready;

	console.log(`Package "${pkg.name}" is ready.`);
})().catch(exc => console.error(exc.stack));
