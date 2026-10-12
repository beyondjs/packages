/**
 * A page as a preview describes it and a delivery that compiles it, for the cases of the web export that do not run a
 * service (`service/test/production.exports.test.mjs`): the description a `Preview` gives for an entry, and the
 * members of the hosted workspace that the export reads (`module`, `resources.styles`, `resources.asset`,
 * `provenance`). The outputs are short texts that name their module, so a case reads where each file came from.
 *
 * The page: `@site/web/main` imports its runtime (`runtime/bundle`), `lib` and, lazily, `@site/web/lazy`; it has a
 * stylesheet that addresses a declared asset, and its code addresses another; `@site/other/widget` imports `lib` at
 * another version through its scope. `runtime/main` is the development coordinator a preview registers, which nothing
 * imports.
 */
const Q = 'target=browser&format=esm&env=development&min=false&sourcemap=inline';

export const description = () => ({
	protocol: 'beyond-dev-files/1',
	entry: { specifier: '@site/web/main', vspecifier: '@site/web@1.0.0/main' },
	importmap: {
		imports: {
			'@site/web/main': `../m/@site/web@1.0.0/modules/main?${Q}`,
			'@site/web/main.css': `../m/@site/web@1.0.0/styles/main?${Q}`,
			'@site/web/lazy': `../m/@site/web@1.0.0/modules/lazy?${Q}`,
			'@site/other/widget': `../m/@site/other@1.0.0/modules/widget?${Q}`,
			'runtime/bundle': `../m/runtime@1.0.0/modules/bundle?${Q}`,
			'runtime/main': `../m/runtime@1.0.0/modules/main?${Q}`,
			lib: `../m/lib@1.0.0/modules/~root?${Q}`
		},
		scopes: { '../m/@site/other@1.0.0/': { lib: `../m/lib@2.0.0/modules/~root?${Q}` } }
	},
	modules: [
		{ specifier: '@site/web/main', source: 'environment', vspecifier: '@site/web@1.0.0/main', url: `../m/@site/web@1.0.0/modules/main?${Q}`, styles: `../m/@site/web@1.0.0/styles/main?${Q}`, scope: 'document' },
		{ specifier: '@site/web/lazy', source: 'environment', vspecifier: '@site/web@1.0.0/lazy', url: `../m/@site/web@1.0.0/modules/lazy?${Q}` },
		{ specifier: '@site/other/widget', source: 'environment', vspecifier: '@site/other@1.0.0/widget', url: `../m/@site/other@1.0.0/modules/widget?${Q}`, widget: true },
		{ specifier: 'runtime/bundle', source: 'environment', url: `../m/runtime@1.0.0/modules/bundle?${Q}` },
		{ specifier: 'runtime/main', source: 'environment', url: `../m/runtime@1.0.0/modules/main?${Q}` },
		{ specifier: 'lib', source: 'environment', version: '1.0.0', url: `../m/lib@1.0.0/modules/~root?${Q}` }
	],
	updates: { runtime: 'runtime/main' },
	diagnostics: []
});

/**
 * What each module builds for production: its dependencies, runtime, stylesheet and code
 */
const MODULES = {
	'@site/web@1.0.0/main': { runtime: 'runtime/bundle', dependencies: ['lib', '@site/web/lazy', '@site/other/widget'], styles: true, code: 'import "runtime/bundle"; import "lib"; import("@site/web/lazy"); const logo = new URL("../assets/main/logo.svg", import.meta.url).href; /* main */' },
	'@site/web@1.0.0/lazy': { dependencies: [], code: 'export const lazy = true; /* lazy */' },
	'@site/other@1.0.0/widget': { runtime: 'runtime/bundle', dependencies: ['lib'], code: 'import "lib"; /* widget */' },
	'runtime@1.0.0/bundle': { dependencies: [], code: '/* runtime bundle */' },
	'runtime@1.0.0/main': { dependencies: ['runtime/bundle'], code: 'new EventSource("/events"); /* development coordinator */' },
	'lib@1.0.0': { key: 'installed', dependencies: [], code: '/* lib 1 */' },
	'lib@2.0.0': { key: 'installed', dependencies: [], code: '/* lib 2 */' }
};

/**
 * The hosted workspace of the page, which records what it was asked to compile
 *
 * @param {{production?: boolean, assets?: Record<string, string>, override?: Record<string, object>}} [options]
 * Whether the bundlers build a production conditional, the declared assets by package and path, and modules to change
 */
export const delivery = ({ production = true, assets = { '@site/web@1.0.0/main/logo.svg': '<svg/>', '@site/web@1.0.0/main/bg.png': 'png' }, override = {} } = {}) => {
	const asked = [];
	const modules = { ...MODULES, ...override };
	return {
		asked,
		projection: { state: 'missing' },
		async module({ name, version, subpath }, conditions) {
			const vspecifier = `${name}@${version}${subpath === '.' ? '' : subpath.slice(1)}`;
			asked.push({ vspecifier, conditions });
			const module = modules[vspecifier];
			if (!module) return { failure: { code: 'MODULE_NOT_FOUND', message: `No module ${vspecifier}` } };
			if (module.failure) return { failure: module.failure };
			const key = module.key ?? (production ? 'web/production' : 'web');
			return {
				delivered: {
					vspecifier,
					hash: 'h',
					key,
					runtime: module.runtime,
					dependencies: module.dependencies.map(specifier => ({ specifier, source: 'workspace' })),
					...(module.styles ? { styles: 'sheet' } : {}),
					code: map => `${module.code}${map === 'none' ? '' : ' //# sourceMappingURL=inline'}`
				}
			};
		},
		resources: {
			async styles({ name, version, subpath }) {
				const key = production ? 'web/production' : 'web';
				return { styles: { code: () => `body{color:rgb(1,2,3);background:url(../assets/main/bg.png)} /* ${name}@${version}${subpath.slice(1)} */` }, key };
			},
			async asset({ name, version, path }) {
				const content = assets[`${name}@${version}/${path}`];
				return content === undefined ? { failure: { code: 'OUTPUT_NOT_AVAILABLE', message: `Package "${name}@${version}" does not declare the asset "${path}"` } } : { content: Buffer.from(content) };
			}
		},
		async provenance() {
			return [{ name: '@site/web', version: '1.0.0', source: 'workspace', node: null, location: '/private/path/not/exported' }];
		}
	};
};
