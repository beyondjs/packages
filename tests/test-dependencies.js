const BEE = require('@beyond-js/bee');

BEE('http://localhost:3000', { inspect: 4000 });

(async () => {
	const { Graph } = await bimport('@beyond-js/packages/dependencies/graph');
	const graph = new Graph({ name: 'cualquiera', version: '1.0.0', dependencies: { react: '18.2.0' } });
	await graph.process();
})().catch(exc => console.error(exc.stack));
