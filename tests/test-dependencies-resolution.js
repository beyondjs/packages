const { join } = require('path');
const BEE = require('@beyond-js/bee');

// Inicializa el entorno BEE apuntando al DevServer de BeyondJS
BEE('http://localhost:3000', { inspect: 4000 });

(async () => {
	// Cargá el módulo que implementa IPackageResolution desde tu workspace
	const { PackageResolution, PackageResolutionType } = await bimport('@beyond-js/packages/dependencies/resolution');

	const tests = [
		{
			name: 'lodash',
			version: '^4.17.0',
			expect: {
				resolution: PackageResolutionType.Semver,
				semver: '^4.17.0',
				repository: 'default'
			}
		},
		{
			name: 'my-lib',
			version: 'https://cdn.example.com/my-lib-1.0.0.tgz',
			expect: {
				resolution: PackageResolutionType.Tarball
			}
		},
		{
			name: 'core',
			version: 'git+https://github.com/user/core.git#dev',
			expect: {
				resolution: PackageResolutionType.Git,
				repository: 'github',
				git: {
					host: 'github.com',
					owner: 'user',
					repo: 'core',
					ref: 'dev'
				}
			}
		}
	];

	for (const test of tests) {
		const result = new PackageResolution(test.name, test.version);
		console.log(`\n== ${test.name}@${test.version}`);
		console.log('Resolution:', result.resolution === test.expect.resolution ? '✅' : '❌', result.resolution);
		if ('semver' in test.expect)
			console.log('Semver:', result.semver === test.expect.semver ? '✅' : '❌', result.semver);
		if ('repository' in test.expect)
			console.log('Repository:', result.repository === test.expect.repository ? '✅' : '❌', result.repository);
		if ('git' in test.expect)
			console.log(
				'Git:',
				JSON.stringify(result.git) === JSON.stringify(test.expect.git) ? '✅' : '❌',
				result.git
			);
	}
})().catch(exc => console.error(exc.stack));
