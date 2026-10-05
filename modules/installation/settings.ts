import type { IPackageProviders } from '@beyond-js/packages/providers/types';
import type { SourcesTransport } from '@beyond-js/packages/sources';
import type { IInstallationDiagnostic, IInstallationParams } from './types';
import { promises as fs } from 'fs';
import { join, resolve } from 'path';
import {
	PackageProviders,
	Metadata,
	FilesystemMetadataStore,
	MemoryMetadataStore
} from '@beyond-js/packages/providers';

/**
 * Where an installation keeps what it reuses between workspaces, and the providers it asks: the source store and
 * the metadata cache of the user, and the provider settings of the workspace read as npm reads them.
 *
 * - The providers are created on first use: a frozen installation whose sources are public and already stored
 *   loads no settings and makes no request. Every request goes through the transport of the installation.
 * - Both directories are created when absent and used by their real path: a store reached through a symbolic link
 *   (`BEYOND_SOURCES_DIR` under `/tmp` on macOS) writes the locations consumers compare, never the link's.
 * - The metadata cache is a cache: when its directory cannot be used, or a record cannot be written, metadata is
 *   kept in memory for this installation and `warnings` says why. A source store that cannot be used fails.
 */
export class Settings {
	#params: IInstallationParams;
	#root: string;
	#transport: SourcesTransport;
	#providers?: PackageProviders;
	#metadata?: Metadata;
	#records?: FilesystemMetadataStore;
	#unusable?: string;

	/**
	 * @param root The canonical workspace root
	 * @param transport How every request reaches the network
	 */
	constructor(params: IInstallationParams, root: string, transport: SourcesTransport) {
		this.#params = params;
		this.#root = root;
		this.#transport = transport;
	}

	/**
	 * The providers, which also know the credentials a private archive needs
	 */
	get providers(): PackageProviders {
		if (this.#providers) return this.#providers;
		const options = { workspace: this.#root, path: this.#root, ...this.#params.providers };
		this.#providers = new PackageProviders({ ...options, fetch: this.#transport });
		return this.#providers;
	}

	/**
	 * Why the metadata cache could not be used or written, as warnings of the installation
	 */
	get warnings(): IInstallationDiagnostic[] {
		const found = [this.#unusable, this.#records?.failure?.message].filter(message => typeof message === 'string');
		return found.map(message => {
			const said = `${message}: metadata is requested again next time`;
			return { code: 'METADATA_CACHE_UNAVAILABLE', message: said, severity: <const>'warning' };
		});
	}

	/**
	 * The providers with the metadata cache of the user: what the resolution reads
	 */
	async metadata(): Promise<IPackageProviders> {
		if (this.#metadata) return this.#metadata;

		const directory = await Settings.#cache(this.#params.metadata, 'BEYOND_METADATA_DIR', 'metadata');
		let store: FilesystemMetadataStore | MemoryMetadataStore;
		try {
			store = this.#records = new FilesystemMetadataStore(await Settings.#canonical(directory, 'metadata cache'));
		} catch (error) {
			store = new MemoryMetadataStore();
			this.#unusable = error.message;
		}
		// A local installation is its own single tenant: what needs credentials is cached for it alone
		this.#metadata = new Metadata(this.providers, { store, tenant: 'local' });
		return this.#metadata;
	}

	/**
	 * The canonical root of the source store
	 *
	 * @throws When it cannot be created or read, naming the directory and the code of the cause
	 */
	async store(): Promise<string> {
		const root = await Settings.#cache(this.#params.store, 'BEYOND_SOURCES_DIR', 'sources');
		return await Settings.#canonical(root, 'source store');
	}

	/**
	 * The real path of a directory, created when absent
	 */
	static async #canonical(directory: string, what: string): Promise<string> {
		try {
			await fs.mkdir(directory, { recursive: true });
			return await fs.realpath(directory);
		} catch (error) {
			throw new Error(`The ${what} ${directory} cannot be used (${error?.code || 'unknown error'})`);
		}
	}

	/**
	 * A directory given explicitly, else the one of an environment variable, else one of the user's cache
	 */
	static async #cache(given: string | undefined, variable: string, name: string): Promise<string> {
		if (given) return resolve(given);
		if (process.env[variable]) return resolve(process.env[variable]);

		// env-paths is an ES module: imported dynamically, as the bundles are also transpiled to CommonJS
		const paths = (await import('env-paths')).default;
		return join(paths('beyond-js').cache, name);
	}
}
