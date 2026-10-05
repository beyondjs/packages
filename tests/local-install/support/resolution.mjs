/**
 * The harness of the workspace resolution tests (`resolution.test.mjs`, `resolution.peers.test.mjs`): the members of
 * `fixtures/resolution`, given as the declaration of a workspace gives them, resolved against the in-process
 * registry of `tests/cdn-resolution`, which publishes `fixtures/resolution/registry.json` and records every request
 * by package, so what is never asked is asserted, not assumed.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resolution } from '@beyond-js/packages/resolution';
import { FakeRegistry } from '../../cdn-resolution/registry.mjs';

const FIXTURES = fileURLToPath(new URL('../fixtures/resolution/', import.meta.url));

/**
 * Workspaces of fixture members and the registry they are resolved against
 */
export class Workspaces {
	#registry = new FakeRegistry({ prefix: '/npm' });
	/**
	 * The registry, whose `log` records every request it received
	 */
	get registry() {
		return this.#registry;
	}

	/**
	 * Starts the registry and publishes the releases of the fixtures
	 */
	async start() {
		await this.#registry.start();
		const { packages } = await this.json('registry.json');
		for (const manifest of packages) await this.#registry.publish(manifest);
	}

	stop() {
		return this.#registry.stop();
	}

	/**
	 * A document of the fixtures, read only
	 */
	async json(path) {
		return JSON.parse(await readFile(join(FIXTURES, path), 'utf8'));
	}

	/**
	 * A member as the declaration of a workspace gives it: its id is its directory relative to the workspace root,
	 * which is `fixtures/resolution/members` (`../outside/…` is a member outside the root)
	 */
	async member(id) {
		const path = join(FIXTURES, 'members', id);
		const manifest = await this.json(join('members', id, 'package.json'));
		return { id, name: manifest.name, version: manifest.version, path, manifest };
	}

	/**
	 * Resolves a workspace of the given members, or of `params.members`, against the registry only: no rc file,
	 * environment or other registry of whoever runs the test is read
	 */
	async resolve(ids, params = {}) {
		const members = params.members || (await Promise.all(ids.map(id => this.member(id))));
		const providers = {
			user: false,
			global: false,
			env: false,
			values: { default: { registry: this.#registry.url } }
		};
		return Resolution.workspace({ providers, ...params, members });
	}

	/**
	 * Every request the registry received for one package: its document, a manifest or an archive
	 */
	requested(name) {
		return this.#registry.log.filter(({ path }) => path === `/npm/${name}` || path.startsWith(`/npm/${name}/`));
	}
}

/**
 * The codes of the diagnostics of a graph, of one severity when it is given, sorted
 */
export const codes = (graph, severity) =>
	graph.diagnostics
		.filter(diagnostic => !severity || diagnostic.severity === severity)
		.map(({ code }) => code)
		.sort();

/**
 * The diagnostics of a graph as text, to explain a failed assertion
 */
export const explain = graph => JSON.stringify(graph.diagnostics);

/**
 * The key of the node of a name and version: a member's when `workspace` is true, another source's otherwise
 */
export const node = (graph, name, version, workspace = false) =>
	Object.entries(graph.nodes).find(
		([, node]) =>
			node.name === name && node.version === version && (node.origin.provider === 'workspace') === workspace
	)?.[0];

/**
 * The edges a node has for one name: the one it declares (an alias) or the name of the target
 */
export const edges = (graph, from, name) =>
	graph.edges.filter(
		edge =>
			edge.from === from && (edge.name === name || (edge.to && !edge.name && graph.nodes[edge.to].name === name))
	);

/**
 * Canonical JSON written independently of the implementation: members sorted by key, no whitespace
 */
export const canonical = value => {
	if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
	if (!value || typeof value !== 'object') return JSON.stringify(value);
	const members = Object.keys(value)
		.sort()
		.map(key => `${JSON.stringify(key)}:${canonical(value[key])}`);
	return `{${members.join(',')}}`;
};
