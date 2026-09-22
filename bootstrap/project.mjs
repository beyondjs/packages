import { mkdirSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * One Beyond-authored project staged so that Engine can serve it: Packages itself, the watchers service and
 * each local utility the installation is given instead of its published copy.
 *
 * Engine takes the port of a project from its manifest and writes its cache beside it, so an installed
 * project is not served in place: its sources are linked into a directory of the service, its manifest is
 * reduced to one ESM distribution on a port that is free now and without development or peer dependencies,
 * and its `node_modules` is linked to where the installation resolved its dependencies.
 */
export class Project {
	#name;
	get name() {
		return this.#name;
	}

	#component;

	/**
	 * The package this project publishes, which is the specifier its public modules are named under
	 */
	get specifier() {
		return this.#component.manifest.name;
	}

	get version() {
		return this.#component.manifest.version;
	}

	#directory;

	/**
	 * The staged project, which is also where the installed dependencies of the project resolve from
	 */
	get directory() {
		return this.#directory;
	}

	#port;

	/**
	 * The origin that serves the compiled project, once the workspace has started
	 */
	get url() {
		return `http://127.0.0.1:${this.#port}`;
	}

	/**
	 * @param {{name: string, component: {path: string, modules: string, manifest: object},
	 * directory: string, port: number}} options
	 */
	constructor({ name, component, directory, port }) {
		this.#name = name;
		this.#component = component;
		this.#directory = directory;
		this.#port = port;
	}

	/**
	 * Links the sources, writes the reduced manifest and answers the path to register in the workspace
	 *
	 * @returns {string} The manifest of this project, relative to the directory of the workspace
	 */
	stage() {
		mkdirSync(this.#directory, { recursive: true });

		const skipped = ['package.json', 'node_modules', '.beyond', '.git'];
		for (const entry of readdirSync(this.#component.path)) {
			if (!skipped.includes(entry)) symlinkSync(join(this.#component.path, entry), join(this.#directory, entry));
		}
		symlinkSync(this.#component.modules, join(this.#directory, 'node_modules'));

		const manifest = JSON.parse(readFileSync(join(this.#component.path, 'package.json'), 'utf8'));

		// Engine refuses to serve a project whose declared packages are not installed, and an installation
		// never has the development dependencies of the implementation, which serving it does not use.
		// Optional peers, such as this bootstrap itself, are not installed dependencies of the project either.
		delete manifest.devDependencies;
		delete manifest.peerDependencies;
		delete manifest.peerDependenciesMeta;

		manifest.deployment = {
			distributions: [
				{
					name: 'node-esm',
					platform: 'node',
					bundles: { mode: 'esm' },
					development: { tools: false },
					ports: { bundles: this.#port }
				}
			]
		};
		writeFileSync(join(this.#directory, 'package.json'), JSON.stringify(manifest, null, '\t'));
		return `${this.#name}/package.json`;
	}
}
