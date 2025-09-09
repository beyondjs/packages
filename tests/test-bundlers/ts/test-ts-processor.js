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

			if (conditional) {
				await conditional.processors.ready;
				const { errors, warnings } = conditional.processors;
				errors?.length && console.log(`  • Processors errors:', ${[...errors].join(', ')}`);
				warnings?.length && console.log(`  • Processors warnings:', ${[...warnings].join(', ')}`);

				const ts = conditional.processors.get('ts');
				console.log('  • Typescript [transcript] processor:', ts ? 'found'.green : 'not found'.red);
				if (ts) {
					const { ims } = ts.outputs;
					console.log('    • Specs:', ts.specs.values);

					// Complete the outputs arrary with the properties 'ims', 'css', and 'types', when they are defined
					const outputs = [];
					if (ts.outputs.ims) outputs.push('ims');
					if (ts.outputs.css) outputs.push('css');
					if (ts.outputs.types) outputs.push('types');
					console.log('    • Outputs:', outputs.length ? outputs.join(', ').green : 'none'.red);

					if (ims) {
						await ims.ready;
						console.log('    • Inputs:', [...ts.sources.inputs.keys()].join(', '));
					}
				}
			} else {
				console.log('  • No default bundler found');
			}
		}
	}

	console.log('End!');
})().catch(exc => console.error(exc));
