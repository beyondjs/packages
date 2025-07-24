const BEE = require('@beyond-js/bee');

BEE('http://localhost:3000', { inspect: 4000 });

(async () => {
	const { db } = await bimport('@beyond-js/packages/persistence/db');
	await db.init();

	const id = `react@18.2.0`;
	const package = await db.packages.get({ id });
	console.log(`Package "${id}":`, package);
})().catch(exc => console.error(exc.stack));
