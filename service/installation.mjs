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
	 * Where a consumer resolves the runtime from, so that it receives it once whatever imports it
	 */
	get runtime() {
		return { packages: ['@beyond-js/kernel'], base: pathToFileURL(join(this.#packages.path, 'package.json')).href };
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
