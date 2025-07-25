const BEE = require('@beyond-js/bee');

let PackageResolution, PackageResolutionType;

beforeAll(async () => {
	// Inicializa el entorno BEE para cargar módulos desde el DevServer de BeyondJS
	BEE('http://localhost:3000', { inspect: 4000 });

	const resolutionModule = await bimport('@beyond-js/packages/dependencies/resolution');
	const typesModule = await bimport('@beyond-js/packages/repositories/types');

	PackageResolution = resolutionModule.PackageResolution;
	PackageResolutionType = typesModule.PackageResolutionType;
});

describe('PackageResolution', () => {
	const cases = [
		{
			name: 'lodash',
			version: '^4.17.0',
			expected: {
				resolution: 'Semver',
				semver: '^4.17.0',
				repository: 'default'
			}
		},
		{
			name: 'my-lib',
			version: 'https://cdn.example.com/my-lib-1.0.0.tgz',
			expected: {
				resolution: 'Tarball'
			}
		},
		{
			name: 'core',
			version: 'git+https://github.com/user/core.git#dev',
			expected: {
				resolution: 'Git',
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

	for (const { name, version, expected } of cases) {
		test(`${name}@${version}`, () => {
			const result = new PackageResolution(name, version);

			expect(result.resolution).toBe(PackageResolutionType[expected.resolution]);
			if (expected.semver) expect(result.semver).toBe(expected.semver);
			if (expected.repository) expect(result.repository).toBe(expected.repository);
			if (expected.git) expect(result.git).toEqual(expected.git);
		});
	}
});
