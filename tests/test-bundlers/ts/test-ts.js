const Workspace = require('beyond/workspace');
require('colors');

const workspace = new Workspace(__dirname);

(async () => {
	await workspace.packages.ready;
	for (const pkg of workspace.packages.values()) {
		await pkg.ready;
		await pkg.modules.ready;

		// Show package information
		const { errors, warnings } = pkg.bundlers;
		console.log('Package:'.green.bold, pkg.vname.green);
		console.log(`  • Registered bundlers: ${[...pkg.bundlers.keys()].join(', ')}`);
		errors.length && console.log(`  • Bundlers errors: ${[...pkg.bundlers.errors].join(', ')}`);
		warnings.length && console.log(`  • Bundlers warnings: ${[...pkg.bundlers.warnings].join(', ')}`);

		// Show modules information
		console.log('\nShow modules information\n'.green.bold);

		for (const module of pkg.modules.values()) {
			await module.ready;
			console.log('Module:'.green.bold, module.subpath?.green);

			const { errors, warnings } = module;
			errors?.length && console.log(`  • Errors found: [...${errors}].join(', ')}`);
			warnings?.length && console.log(`  • Warnings found: [...${warnings}].join(', ')}`);

			await module.conditionals.ready;
			console.log('  • Conditionals:', [...module.conditionals.keys()].join(', '));

			const conditional = module.conditionals.get('default');
			console.log('  • Default conditional outputs:', [...conditional.outputs.keys()].join(', '));

			const esm = conditional.outputs.get('esm');
			if (esm) {
				await esm.ready;
				const { errors, warnings } = esm;
				errors?.length && console.log(`  • ESM output errors:', ${[...errors].join(', ')}`);
				warnings?.length && console.log(`  • ESM output warnings:', ${[...warnings].join(', ')}`);
			} else {
				console.log('  • No default bundler found');
			}
		}
	}

	console.log('End!');
})().catch(exc => console.error(exc));
