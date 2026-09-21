import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Component } from './component.mjs';

/**
 * The installed Packages that a development service runs, located from this file. Nothing refers to a
 * checkout, a sibling directory or the working directory, so an installation works wherever it is placed.
 */
export class Installation {
	#packages = new Component(fileURLToPath(new URL('../package.json', import.meta.url)));
	#contract = Component.installed('@beyond-js/artifact-api', import.meta.url);

	get packages() {
		return this.#packages;
	}

	/**
	 * Whether this distribution carries its compiled implementation. A compiled distribution declares its
	 * public modules in the `exports` of its manifest, which is what lets Node resolve them; one that
	 * carries sources declares only its plain entry points there.
	 */
	get compiled() {
		return !!this.#packages.manifest.exports?.['./workspace'];
	}

	/**
	 * The Beyond-authored packages the toolchain supplies to every workspace, when they are installed: the
	 * development runtime and the Widgets packages. The service compiles and serves them like the packages
	 * of the workspace, so a project needs neither a checkout nor a copy of them.
	 */
	static SUPPLIED = ['@beyond-js/local-2026', '@beyond-js/widgets', '@beyond-js/react-19-widgets', '@beyond-js/vue-widgets', '@beyond-js/svelte-widgets'];

	#supplied;

	/**
	 * The supplied packages that are installed, as `{name, path, dependencies}`
	 */
	get supplied() {
		if (this.#supplied) return this.#supplied;
		this.#supplied = [];
		for (const name of Installation.SUPPLIED) {
			let component;
			try {
				component = Component.installed(name, import.meta.url);
			} catch {
				continue;
			}
			const { beyond, dependencies = {} } = component.manifest;
			if (!beyond || typeof beyond !== 'object') continue;
			this.#supplied.push({ name, path: component.path, dependencies: Object.keys(dependencies) });
		}
		return this.#supplied;
	}

	/**
	 * Where a consumer resolves the runtime from, so that it receives it once whatever imports it.
	 *
	 * The packages named here resolve from the installation: the Kernel, and the libraries the supplied
	 * packages depend on and are not themselves supplied (a framework such as React or Vue), so that a
	 * widget of the workspace and the adapter of the toolchain share one copy of the framework.
	 */
	get runtime() {
		const supplied = new Set(this.supplied.map(({ name }) => name));
		const packages = new Set(['@beyond-js/kernel']);
		this.supplied.forEach(({ dependencies }) => dependencies.forEach(name => !supplied.has(name) && packages.add(name)));
		return { packages: [...packages], base: pathToFileURL(join(this.#packages.path, 'package.json')).href };
	}

	get versions() {
		return { packages: this.#packages.version, contract: this.#contract.version, node: process.versions.node };
	}

	/**
	 * What makes two installations interchangeable for a running service: the same Packages, in the same
	 * form, at the same version, in the same place. A service started by another installation is not reused.
	 */
	get id() {
		const { packages, contract } = this.versions;
		const identity = JSON.stringify({ packages, contract, compiled: this.compiled, path: this.#packages.path });
		return createHash('sha256').update(identity).digest('hex').slice(0, 16);
	}
}
