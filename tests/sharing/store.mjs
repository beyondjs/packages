/**
 * The pinned inputs of the sharing validation: small ordinary npm packages whose public subpaths relate to
 * each other in the ways the delivery has to tell apart, and an application that imports every one of them.
 *
 * Nothing is downloaded and nothing of the suite is copied: each package is a checked-in directory under
 * `./fixtures/`, so what a role depends on — which files a subpath reaches and which names it exports — is
 * readable as ordinary source. The local README says what each one is expected to be delivered as.
 */
import { cp, mkdtemp, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store as Pinned } from '../preparation/store.mjs';

const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));

/**
 * Each fixture package, by the directory it is checked in under, in the order its node enters the graph
 */
const PACKAGES = {
	'@fixture/shared-state': 'shared-state',
	'@fixture/independent': 'independent',
	'@fixture/collision': 'collision',
	'@fixture/defaulted': 'defaulted',
	'@fixture/commonjs': 'commonjs',
	'@fixture/opaque': 'opaque',
	'@fixture/app': 'app'
};

export const ENTRY = '@fixture/app/main';

/**
 * The fixtures copied to a temporary directory and pinned as a graph, in the shape `Analysis` and
 * `Generation` take
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

		for (const [name, fixture] of Object.entries(PACKAGES)) {
			const directory = join(this.#root, name.replace(/[^\w.-]+/g, '_'));
			await cp(join(FIXTURES, fixture), directory, { recursive: true });
			this.#packages.set(`npm:${name}@1.0.0`, directory);
		}
		return this;
	}
}
