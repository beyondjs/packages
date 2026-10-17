import type { IPackageProviders } from '@beyond-js/packages/providers/types';
import type { SourcesTransport } from '@beyond-js/packages/sources';
import { existsSync, statSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { ToolchainCatalog } from './catalog';
import { SuppliedMetadata } from './metadata';
import { ToolchainTransport } from './transport';

export { ToolchainAddress } from './address';

/**
 * The package archives the Beyond toolchain carries, as an explicit source of an installation.
 *
 * Beyond's own runtime packages (the development runtime, Widgets and its framework adapters) are packed into the
 * installation of the command line, and into a toolchain bundle for CI, before any of them is published to a
 * registry. An installation asks its registries first: a release the registry publishes is taken from it, and a
 * release only the toolchain carries is supplied from its archive. The lock records such a node with the origin
 * `toolchain`, its archive address `toolchain:<name>@<version>` and the `sha512` integrity of the archive, so the
 * next installation, here or on a CI runner with the same toolchain, fetches the same bytes or fails naming them. No
 * path of this machine is recorded.
 *
 * Where the archives are, in order:
 * - the `toolchain` parameter of the installation (`false` turns the source off);
 * - `BEYOND_TOOLCHAIN_ARCHIVES`, a directory of archives (empty turns it off);
 * - the installation that runs this process: the first directory above the started script that holds
 *   `installation.json` (an installation of the command line) or `bundle.json` (an extracted toolchain bundle) beside
 *   an `archives/` directory.
 */
export class Toolchain {
	static VARIABLE = 'BEYOND_TOOLCHAIN_ARCHIVES';

	#catalog: ToolchainCatalog;

	get catalog(): ToolchainCatalog {
		return this.#catalog;
	}

	get directory(): string {
		return this.#catalog.directory;
	}

	constructor(directory: string) {
		this.#catalog = new ToolchainCatalog(resolve(directory));
	}

	/**
	 * The toolchain of an installation, or undefined when there is none
	 *
	 * @param given The `toolchain` parameter of the installation
	 */
	static locate(given?: string | false): Toolchain | undefined {
		if (given === false) return;
		if (typeof given === 'string' && given) return new Toolchain(given);

		const variable = process.env[Toolchain.VARIABLE];
		if (variable !== void 0) return variable ? new Toolchain(variable) : void 0;

		const found = Toolchain.#above(process.argv[1]);
		return found ? new Toolchain(found) : void 0;
	}

	/**
	 * The `archives/` directory of the installation or bundle a script was started from
	 */
	static #above(script?: string): string | undefined {
		if (typeof script !== 'string' || !script) return;
		let directory = dirname(resolve(script));
		for (;;) {
			const archives = join(directory, 'archives');
			const marked = existsSync(join(directory, 'installation.json')) || existsSync(join(directory, 'bundle.json'));
			if (marked && Toolchain.#directory(archives)) return archives;
			const parent = dirname(directory);
			if (parent === directory) return;
			directory = parent;
		}
	}

	static #directory(path: string): boolean {
		try {
			return statSync(path).isDirectory();
		} catch {
			return false;
		}
	}

	/**
	 * The metadata of an installation with the releases only this toolchain carries added
	 */
	metadata(registries: IPackageProviders): IPackageProviders {
		return new SuppliedMetadata(registries, this.#catalog);
	}

	/**
	 * A transport that answers the archive addresses of this toolchain and sends every other request on
	 */
	transport(next: SourcesTransport): SourcesTransport {
		return new ToolchainTransport(this.#catalog, next).transport;
	}
}
