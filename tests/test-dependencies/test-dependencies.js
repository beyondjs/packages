const BEE = require('@beyond-js/bee');

BEE('http://localhost:1110', { inspect: 4000 });

(async () => {
	const { Graph } = await bimport('@beyond-js/packages/dependencies/graph');

	const dependencies = { react: '18.2.0' };
	const graph = new Graph({ name: 'cualquiera', version: '1.0.0', dependencies });
	await graph.process();
})().catch(exc => console.error(exc.stack));
