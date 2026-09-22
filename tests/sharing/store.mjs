/**
 * The pinned inputs of the sharing validation: small ordinary npm packages whose public subpaths relate to
 * each other in the ways the delivery has to tell apart, and an application that imports every one of them.
 *
 * Nothing is downloaded and nothing of the suite is copied: each package is written here, so what a role
 * depends on — which files a subpath reaches and which names it exports — is visible in this file.
 */
import { mkdir, mkdtemp, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Store as Pinned } from '../preparation/store.mjs';

/**
 * Each fixture package, with the files it publishes. The comment on each one says what its subpaths are
 * expected to be delivered as, which is what the checks assert.
 */
const PACKAGES = {
	/**
	 * The shape that loses a runtime: the root imports a file of the `./state` directory that is not the
	 * entry point of that subpath, so without a plan it bundles a copy of it while `./state` keeps its own
	 * and the two hold different values. It also reaches the entry point, which is what relates them.
	 */
	'@fixture/shared-state': {
		exports: { '.': './src/index.js', './state': './src/state/index.js', './package.json': './package.json' },
		files: {
			'src/state/store.js': `export const store = { value: 0 };\nexport const bump = () => ++store.value;\n`,
			'src/state/index.js': `export { store, bump } from './store.js';\n`,
			'src/index.js': `import { bump } from './state/index.js';
import { store } from './state/store.js';
export const use = () => bump();
export const seen = () => store.value;
`
		}
	},

	/** Two subpaths that reach nothing of each other: each is delivered on its own */
	'@fixture/independent': {
		exports: { '.': './src/a.js', './b': './src/b.js', './package.json': './package.json' },
		files: { 'src/a.js': `export const a = () => 'a';\n`, 'src/b.js': `export const b = () => 'b';\n` }
	},

	/**
	 * The same shape as the one above, except that both subpaths export `value`. A union that starred its
	 * re-exports would make that name ambiguous and the compiler would drop it without saying so; naming
	 * every re-export carries it for both
	 */
	'@fixture/collision': {
		exports: { '.': './src/index.js', './state': './src/state/index.js', './package.json': './package.json' },
		files: {
			'src/state/store.js': `export const value = () => 'state';\n`,
			'src/state/index.js': `export { value } from './store.js';\n`,
			'src/index.js': `import { value as inner } from './state/index.js';
import { value as copied } from './state/store.js';
export const value = () => \`root:\${inner()}:\${copied()}\`;
`
		}
	},

	/** The contained subpath has a default export, which `export *` never carries: the facade names it back */
	'@fixture/defaulted': {
		exports: { '.': './src/index.js', './view': './src/view/index.js', './package.json': './package.json' },
		files: {
			'src/view/state.js': `export const seen = [];\n`,
			'src/view/index.js': `import { seen } from './state.js';
export const count = () => seen.length;
export default mark => (seen.push(mark), seen.length);
`,
			'src/index.js': `import view from './view/index.js';
import { seen } from './view/state.js';
export const run = mark => view(mark);
export const marks = () => seen.length;
`
		}
	},

	/** The same shape written as CommonJS, which is not an ES module boundary: neither subpath is planned */
	'@fixture/commonjs': {
		type: 'commonjs',
		exports: { '.': './src/index.js', './state': './src/state.js', './package.json': './package.json' },
		files: {
			'src/state.js': `const store = { value: 0 };\nexports.store = store;\nexports.bump = () => ++store.value;\n`,
			'src/index.js': `const state = require('./state.js');
exports.use = () => state.bump();
exports.value = () => state.store.value;
`
		}
	},

	/**
	 * A subpath whose own API cannot be listed, because it re-exports an external package with a star: it
	 * is not carried, and the root keeps the copy of the state it reaches directly
	 */
	'@fixture/opaque': {
		exports: { '.': './src/index.js', './state': './src/state/index.js', './package.json': './package.json' },
		files: {
			'src/state/store.js': `export const held = { value: 0 };\n`,
			'src/state/index.js': `export * from '@fixture/independent';
export { held } from './store.js';
`,
			'src/index.js': `import { held } from './state/index.js';
import { held as copied } from './state/store.js';
export const bumped = () => ++copied.value;
export const privately = () => copied.value;
export const shared = () => held.value;
`
		}
	},

	/** The application: it imports every public subpath the roles decide about */
	'@fixture/app': {
		exports: { './main': './src/main.js', './package.json': './package.json' },
		files: {
			'src/main.js': `import { use, seen } from '@fixture/shared-state';
import { store, bump } from '@fixture/shared-state/state';
import { run, marks } from '@fixture/defaulted';
import view, { count } from '@fixture/defaulted/view';
import { a } from '@fixture/independent';
import { b } from '@fixture/independent/b';
import { value as root } from '@fixture/collision';
import { value as inner } from '@fixture/collision/state';
import { use as required, value as own } from '@fixture/commonjs';
import { store as apart } from '@fixture/commonjs/state';
import { bumped, privately, shared } from '@fixture/opaque';
import { held } from '@fixture/opaque/state';

/**
 * What the delivered application observes: the state each package holds, written through one of its public
 * subpaths and read through the other
 */
export const report = () => {
	use();
	bump();
	run(1);
	view(2);
	required();
	bumped();
	return {
		shared: [seen(), store.value],
		defaulted: [marks(), count()],
		independent: [a(), b()],
		collision: [root(), inner()],
		commonjs: [own(), apart.value],
		opaque: [privately(), shared(), held.value]
	};
};
`
		}
	}
};

export const ENTRY = '@fixture/app/main';

/**
 * The fixtures written to disk and pinned as a graph, in the shape `Analysis` and `Generation` take
 */
export class Store {
	#root;
	get root() {
		return this.#root;
	}

	#packages = new Map();

	get sources() {
		return Object.fromEntries([...this.#packages].map(([key, directory]) => [key, directory]));
	}

	key(name) {
		return [...this.#packages.keys()].find(one => one.startsWith(`npm:${name}@`));
	}

	/**
	 * Every fixture depends on every other one: what a resolution would pin is not what this validation
	 * checks, and a complete set of edges lets any reference of any of them land
	 */
	get graph() {
		const keys = [...this.#packages.keys()];
		const nodes = Object.fromEntries(keys.map(key => [key, Pinned.node(...Store.#parse(key))]));
		const edges = keys.flatMap(from => keys.filter(to => to !== from).map(to => ({ from, to, kind: 'dependency', range: '*' })));
		const app = this.key('@fixture/app');
		const roots = [{ name: '@fixture/app', range: '1.0.0', node: app, targets: ['backend'] }];
		return Pinned.seal({ protocol: 'beyond-graph/1', roots, nodes, edges, overrides: [], lock: { reused: false }, exceptions: [], diagnostics: [] });
	}

	static #parse(key) {
		const specifier = key.slice('npm:'.length);
		const at = specifier.lastIndexOf('@');
		return [specifier.slice(0, at), specifier.slice(at + 1)];
	}

	async create() {
		this.#root = await realpath(await mkdtemp(join(tmpdir(), 'beyond-sharing-')));

		for (const [name, { exports, files, type = 'module' }] of Object.entries(PACKAGES)) {
			const directory = join(this.#root, name.replace(/[^\w.-]+/g, '_'));
			const manifest = { name, version: '1.0.0', type, exports };
			await mkdir(directory, { recursive: true });
			await writeFile(join(directory, 'package.json'), JSON.stringify(manifest, null, '\t'));

			for (const [path, code] of Object.entries(files)) {
				await mkdir(dirname(join(directory, path)), { recursive: true });
				await writeFile(join(directory, path), code);
			}
			this.#packages.set(`npm:${name}@1.0.0`, directory);
		}
		return this;
	}
}
