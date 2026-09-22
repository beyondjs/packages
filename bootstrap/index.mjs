import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Component } from '@beyond-js/packages/service';
import { Selection } from './selection.mjs';
import { Workspace } from './workspace.mjs';

/**
 * Prepares the implementation of a Packages distribution that carries sources.
 *
 * It is the transitional path of `Implementation` in `@beyond-js/packages/service`: one Engine development
 * server compiles and serves the Beyond-authored implementation (Packages, the watchers service that its
 * published package does not include compiled, and the utilities selected to come from their sources), and
 * the host is started under BEE Node with the engine adapter against them. Engine never sees the workspace
 * that the service serves.
 *
 * Everything that knows about Engine is in this package, together with its dependencies: Engine itself, the
 * loader, the Node declarations Engine's compiler needs and the dependencies of a service compiled from
 * bundled source. A compiled Packages distribution needs none of it, and removing this package is the whole
 * migration.
 */
export class Bootstrap {
	/** The package whose service the watchers child runs, which is always compiled from source */
	static WATCHERS = '@beyond-js/watchers';

	#packages;
	#workspace;

	/**
	 * @param {Component} packages The installed Packages whose sources are compiled
	 */
	constructor(packages) {
		this.#packages = packages;
	}

	/**
	 * @param {{directory: string, log: string}} options Where to stage the projects, and the log of the service
	 */
	async prepare({ directory, log }) {
		const self = new Component(fileURLToPath(new URL('./package.json', import.meta.url)));
		const engine = Component.installed('beyond', import.meta.url);
		const loader = Component.installed('@beyond-js/bee-node', import.meta.url);

		// The packages served from their sources instead of the copies the installation resolved
		const selection = new Selection();
		const local = new Map(selection.entries.map(({ name, path }) => [name, path]));

		// The watchers service is compiled from source whether or not its package is selected, because the
		// published one carries its client alone
		const watchers = local.get(Bootstrap.WATCHERS) ?? fileURLToPath(new URL('./resources/watchers', import.meta.url));
		Selection.source(Bootstrap.WATCHERS, watchers);

		const projects = [
			{ name: 'packages', component: this.#packages },
			{ name: 'watchers', component: new Component(join(watchers, 'package.json'), self) }
		];
		for (const [name, path] of local) {
			if (name === Bootstrap.WATCHERS) continue;

			// A utility resolves the dependencies of the implementation: it replaces the copy installed there
			projects.push({ name: name.split('/').pop(), component: new Component(join(path, 'package.json'), this.#packages) });
		}

		this.#workspace = new Workspace({ directory, engine, log });
		await this.#workspace.start(projects);

		const served = this.#workspace.projects;
		const adapter = { BEE_ADAPTER: 'engine', BEE_IMPORT_MAP: '' };

		// The host reads the implementation and every selected package from the origin that publishes it
		const hosts = [served.get('packages'), ...[...local.keys()].map(name => served.get(name.split('/').pop()))];

		const versions = { bootstrap: self.version, engine: engine.version, loader: loader.version };
		for (const name of local.keys()) {
			const project = served.get(name.split('/').pop());
			versions[name] = `${project.version} (local: ${project.url})`;
		}

		return {
			execArgv: ['--import', pathToFileURL(join(loader.path, 'register.mjs')).href],
			env: { BEE_URL: hosts.map(project => project.url).join(','), ...adapter },

			// The installed dependencies of the implementation resolve from its staged project
			cwd: served.get('packages').directory,
			watchers: { env: { BEE_URL: served.get('watchers').url, ...adapter }, cwd: served.get('watchers').directory },
			groups: [this.#workspace.group],
			versions
		};
	}

	async stop() {
		await this.#workspace?.stop();
		this.#workspace = undefined;
	}
}
