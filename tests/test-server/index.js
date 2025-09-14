require('colors');
const BEE = require('@beyond-js/bee');

BEE('http://localhost:1110', { inspect: 4000 });

(async () => {
	const { server } = await bimport('@beyond-js/packages/http/server');
	server.start();
})().catch(exc => console.error(exc.stack));
