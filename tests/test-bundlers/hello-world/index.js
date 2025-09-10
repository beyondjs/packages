require('colors');
const BEE = require('@beyond-js/bee');
const { join } = require('path');

BEE('http://localhost:1110', { inspect: 4000 });

(async () => {
	const { WatcherClient } = await bimport('@beyond-js/watchers/client');
	const { Package } = await bimport('@beyond-js/packages/package');

	const pkg = new Package(join(__dirname, 'package'));
	await pkg.ready;
	console.log(`Package "${pkg.name}" is ready.\n`.green.bold);

	console.log('1. Process package bundler:'.green.bold);
	await pkg.bundlers.ready;
	console.log('  • Bundlers are valid:', pkg.bundlers.valid, !pkg.bundlers.valid ? pkg.bundlers.errors : '');
	console.log('  • Bundlers:', [...pkg.bundlers.keys()]);

	const bundler = pkg.bundlers.get('ts');
	console.log(`  • Process "ts" bundler`);
	await bundler.ready;
	console.log('  • Module class from Bundler:', bundler.Module);

	// console.log('');
	// // Process package modules
	// console.log('2. Process package modules:'.green.bold);
	// await pkg.modules.ready;
	// console.log('  • Modules warnings:', pkg.modules.warnings);
	// console.log('  • Modules:', [...pkg.modules.keys()]);

	// // Process specific module (./utils)
	// console.log('');
	// console.log('3. Process specific module (./utils):'.green.bold);
	// const module = pkg.modules.get('./utils');
	// await module.conditionals.ready;
	// console.log(`  • Module "./utils" conditionals`, [...module.conditionals.keys()]);

	// // Process specific conditional (node) of the module (./utils)
	// console.log('');
	// console.log('4. Process specific conditional (node) of the module (./utils):'.green.bold);
	// const conditional = module.conditionals.get('node');
	// const { outputs } = conditional;
	// await outputs.ready;
	// console.log('  • Outputs are processed and valid:', outputs.processed, outputs.valid);
	// !outputs.valid && console.log('  • Outputs errors:', JSON.stringify(outputs.errors));
	// console.log('  • Conditional "node" outputs:', [...outputs.keys()]);
})().catch(exc => console.error(exc.stack));
