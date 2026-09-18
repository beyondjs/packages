import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Component } from '@beyond-js/packages/service';
import { Implementation } from './implementation.mjs';

/**
 * Prepares the implementation of a Packages distribution that carries sources.
 *
 * It is the transitional path of `Implementation` in `@beyond-js/packages/service`: two Engine development
 * servers compile and serve the Beyond-authored implementation (Packages, and the watchers service that its
 * published package does not include compiled), and the host is started under BEE Node with the engine
 * adapter against them. Engine never sees the workspace that the service serves.
 *
 * Everything that knows about Engine is in this package, together with its dependencies: Engine itself, the
 * loader, the Node declarations Engine's compiler needs and the dependencies of the watchers service. A
 * compiled Packages distribution needs none of it, and removing this package is the whole migration.
 */
export class Bootstrap {
	#packages;
	#servers = [];

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

		const resource = fileURLToPath(new URL('./resources/watchers/package.json', import.meta.url));
		if (!existsSync(resource)) {
			throw new Error(
				`The watchers service resource is missing (${resource}). ` +
					`In a checkout, generate it with "npm run resources"; an installed package includes it.`
			);
		}

		const server = (name, component) =>
			new Implementation({ name, component, engine, directory: join(directory, name), log });
		const packages = server('packages', this.#packages);
		const watchers = server('watchers', new Component(resource, self));
		this.#servers = [packages, watchers];

		try {
			await Promise.all([packages.start(), watchers.start()]);
		} catch (error) {
			await this.stop();
			throw error;
		}

		const adapter = { BEE_ADAPTER: 'engine', BEE_IMPORT_MAP: '' };
		return {
			execArgv: ['--import', pathToFileURL(join(loader.path, 'register.mjs')).href],
			env: { BEE_URL: packages.url, ...adapter },

			// The installed dependencies of the implementation resolve from its staged project
			cwd: packages.directory,
			watchers: { env: { BEE_URL: watchers.url, ...adapter }, cwd: watchers.directory },
			groups: [packages.group, watchers.group],
			versions: { bootstrap: self.version, engine: engine.version, loader: loader.version }
		};
	}

	async stop() {
		await Promise.all(this.#servers.map(server => server.stop()));
		this.#servers = [];
	}
}
