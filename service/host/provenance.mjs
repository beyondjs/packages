import { Component } from '../component.mjs';

/**
 * Where every package the service serves comes from, as `GET /state` reports it, so that nothing is consumed
 * from a place nobody can see.
 *
 * - `workspace`: a member of the workspace, read from its own directory.
 * - `supplied`: a package the toolchain supplies (never with an installed graph).
 * - `store`: a node of the installed graph, read from the source store the installation filled.
 * - `installation`: a runtime package a Node consumer resolves from the toolchain installation: the ones the
 *   session lists in `runtime.packages` (with an installed graph, only the toolchain's own runtime, when the graph
 *   does not provide it: see `Composition.runtime`).
 *
 * Each entry names the node of the installed graph it is, when there is one, and the directory it is read from.
 */
export class Provenance {
	#workspace;
	#composition;

	/**
	 * @param {{ready: Promise<unknown>, packages: Map<string, object>, supplies: (pkg: object) => boolean}}
	 * workspace The Packages workspace of the generation
	 * @param {import('./composition.mjs').Composition} composition What the generation is made of, its runtime
	 * included
	 */
	constructor(workspace, composition) {
		this.#workspace = workspace;
		this.#composition = composition;
	}

	/**
	 * @returns {Promise<{name: string, version: string | null, source: 'workspace' | 'supplied' | 'store' |
	 * 'installation', node: string | null, location: string | null}[]>}
	 */
	async list() {
		return [...(await this.#packages()), ...this.#store(), ...this.#installation()];
	}

	/**
	 * The packages of the Packages workspace: its members and the supplied packages it was given
	 */
	async #packages() {
		await this.#workspace.ready;
		const packages = [...this.#workspace.packages.values()];
		await Promise.all(packages.map(pkg => pkg.ready));

		const { execution } = this.#composition;
		return packages
			.filter(pkg => pkg.name)
			.map(pkg => ({
				name: pkg.name,
				version: pkg.version ?? null,
				source: this.#workspace.supplies(pkg) ? 'supplied' : 'workspace',
				node: execution?.instance(pkg.path) ?? null,
				location: pkg.path
			}));
	}

	/**
	 * The installed nodes of the graph that are not members, by node key
	 */
	#store() {
		const { execution } = this.#composition;
		if (!execution) return [];

		return [...execution.nodes]
			.filter(([key]) => !key.startsWith('workspace:'))
			.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
			.map(([key, node]) => ({ name: node.name, version: node.version, source: 'store', node: key, location: node.location }));
	}

	/**
	 * The runtime packages a Node consumer resolves from the toolchain installation, where they are installed
	 */
	#installation() {
		const { packages = [], base } = this.#composition.runtime ?? {};
		if (!base) return [];

		return packages.map(name => {
			try {
				const component = Component.installed(name, base);
				return { name, version: component.version ?? null, source: 'installation', node: null, location: component.path };
			} catch {
				return { name, version: null, source: 'installation', node: null, location: null };
			}
		});
	}
}
