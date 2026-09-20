/**
 * The packages the checks run on, written to a temporary directory by the harness.
 *
 * `app` is a package authored with the model Packages compiles: its public modules are `exports` entries
 * whose targets are entry points. Each module isolates one behavior of the semantic check. `shared` is the
 * package of Beyond sources `app` depends on, `typed/node_modules` is a `node_modules`-like root with a
 * package that ships declarations, `store/compiled` is an extracted compiled package, `declared` holds a loose
 * declaration file, and `outside` is a location the check of `app` must never read.
 */
const modules = [
	'broken',
	'clean',
	'syntax',
	'consumer',
	'misuse',
	'rooted',
	'platform',
	'escape',
	'large',
	'configured',
	'compiled',
	'own',
	'derived'
];
const bundlers = { ts: '@beyond-js/packages/bundlers/ts' };

const large = Object.fromEntries(
	Array.from({ length: 12 }, (_, index) => [
		`app/large/part-${index}.ts`,
		`export const part${index}: number = ${index};\nexport function double${index}(value: number): number {\n\treturn value * 2;\n}\n`
	])
);

export const files = {
	'beyond.json': { packages: ['shared', 'app'] },

	'app/package.json': {
		name: '@fixture/app',
		version: '1.0.0',
		private: true,
		exports: Object.fromEntries(modules.map(name => [`./${name}`, `./${name}/index.ts`])),
		dependencies: { '@fixture/shared': '1.0.0' },
		beyond: { modules: '.', bundler: 'ts' },
		bundlers
	},

	// Both errors are valid syntax, so a per-file transformation accepts them
	'app/broken/geometry.ts':
		'export function area(width: number, height: number): number {\n\treturn width * height;\n}\n',
	'app/broken/index.ts':
		`import { area } from './geometry';\n\n` +
		`export const size: number = 'text';\n` +
		`export const total = area('3', 4);\n`,

	'app/clean/format.ts': 'export function format(subject: string): string {\n\treturn `Hello, ${subject}`;\n}\n',
	'app/clean/index.ts': `import { format } from './format';\n\nexport const message: string = format('world');\n`,

	'app/syntax/index.ts': 'export function broken( {\n\treturn 1;\n}\n',

	'app/consumer/index.ts':
		`import { greet, type Greeting } from '@fixture/shared/message';\n\n` +
		`export const hello: Greeting = greet('world');\nexport const text: string = hello.text;\n`,

	// Only an error when the types of the dependency are known: the returned value is not a number
	'app/misuse/index.ts': `import { greet } from '@fixture/shared/message';\n\nexport const size: number = greet('world');\n`,

	'app/rooted/index.ts':
		`import { measure } from '@fixture/typed';\n\n` +
		`export const length: number = measure('abc');\nexport const wrong: string = measure('abc');\n`,

	// Everything here needs the types of the platform, which the fixture does not install
	'app/platform/index.ts':
		`import { join } from 'path';\nimport { readFileSync } from 'node:fs';\n\n` +
		`export const home = join(process.env.HOME ?? '', 'data');\n` +
		`export const bytes = Buffer.from(readFileSync(home));\nexport const cwd = process.cwd();\n`,

	'app/compiled/index.ts':
		`import { tool } from '@fixture/compiled/tool';\nimport { alpha } from '@fixture/compiled/features/alpha';\n\n` +
		`export const named: string = tool(alpha);\nexport const wrong: number = tool(alpha);\n`,

	// A module that imports another public module of its own package, by its public specifier
	'app/own/index.ts': `import { message } from '@fixture/app/clean';\n\nexport const size: number = message;\n`,

	// `untyped` is a genuine implicit any; the callback parameter is one only while the dependency has no types
	'app/derived/index.ts':
		`import { greetings } from '@fixture/shared/message';\n\n` +
		`export function untyped(value) {\n\treturn value;\n}\n` +
		`export const texts = greetings.map(one => one.text);\n`,

	'app/escape/index.ts': `import { secret } from '../../outside/secret';\n\nexport const leaked: number = secret;\n`,

	'app/large/index.ts':
		Array.from({ length: 12 }, (_, index) => `export * from './part-${index}';`).join('\n') + '\n',
	...large,

	'app/configured/tsconfig.json': { extends: './missing.json', compilerOptions: { strict: true } },
	'app/configured/index.ts': 'export const configured = true;\n',

	'shared/package.json': {
		name: '@fixture/shared',
		version: '1.0.0',
		private: true,
		exports: { './message': './message/index.ts' },
		beyond: { modules: '.', bundler: 'ts' },
		bundlers
	},
	'shared/message/index.ts':
		'export interface Greeting {\n\ttext: string;\n}\n\n' +
		'export function greet(subject: string): Greeting {\n\treturn { text: `Hello, ${subject}` };\n}\n\n' +
		`export const greetings: Greeting[] = [greet('world')];\n`,

	'typed/node_modules/@fixture/typed/package.json': {
		name: '@fixture/typed',
		version: '1.0.0',
		main: 'index.js',
		types: 'index.d.ts'
	},
	'typed/node_modules/@fixture/typed/index.js': 'exports.measure = value => value.length;\n',
	'typed/node_modules/@fixture/typed/index.d.ts': 'export declare function measure(value: string): number;\n',

	// A compiled package: a `types` condition, and a pattern whose JavaScript targets have sibling declarations
	'store/compiled/package.json': {
		name: '@fixture/compiled',
		version: '2.0.0',
		exports: {
			'./tool': { types: './dist/tool.d.ts', import: './dist/tool.js' },
			'./features/*': './dist/features/*.js'
		}
	},
	'store/compiled/dist/tool.js': 'export const tool = feature => feature.name;\n',
	'store/compiled/dist/tool.d.ts': 'export declare function tool(feature: { name: string }): string;\n',
	'store/compiled/dist/features/alpha.js': `export const alpha = { name: 'alpha' };\n`,
	'store/compiled/dist/features/alpha.d.ts': 'export declare const alpha: { name: string };\n',

	'declared/message.d.ts':
		'export interface Greeting {\n\ttext: string;\n}\nexport declare function greet(subject: string): Greeting;\n',

	'outside/secret.ts': `export const secret: string = 'not readable';\n`
};
