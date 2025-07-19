// Just start a BEE to run the debug console
// For example, you could use this runner to dynamically import your modules and to use HMR

const BEE = require('@beyond-js/bee');
BEE('http://localhost:3000', { inspect: 4000 });

(async () => {
	const { hello } = await bimport('@beyond-js/packages/blank-test');
	console.log(hello);
})().catch(exc => console.error(exc.stack));
