import type { IPackageProviders } from '@beyond-js/packages/providers/types';
import type { SourcesTransport } from '@beyond-js/packages/sources';
import type { IInstallationDiagnostic, IInstallationParams } from './types';
import { promises as fs } from 'fs';
import { join, resolve } from 'path';
import { Toolchain } from './toolchain/index';
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
	#supplied?: IPackageProviders;
	#records?: FilesystemMetadataStore;
	#unusable?: string;
	#toolchain?: Toolchain | null;

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
	 * The archives the toolchain carries, located once; undefined when there are none
	 */
	get toolchain(): Toolchain | undefined {
		if (this.#toolchain === void 0) this.#toolchain = Toolchain.locate(this.#params.toolchain) ?? null;
		return this.#toolchain ?? void 0;
	}

	/**
	 * Why the metadata cache could not be used or written, as warnings of the installation
	 */
	get warnings(): IInstallationDiagnostic[] {
		const found = [this.#unusable, this.#records?.failure?.message].filter(message => typeof message === 'string');
		const cache = found.map(message => {
			const said = `${message}: metadata is requested again next time`;
			return { code: 'METADATA_CACHE_UNAVAILABLE', message: said, severity: <const>'warning' };
		});
		const left = (this.#toolchain?.catalog.problems ?? []).map(message => ({
			code: 'TOOLCHAIN_ARCHIVE_UNREADABLE',
			message,
			severity: <const>'warning'
		}));
		return [...cache, ...left];
	}

	/**
	 * The providers with the metadata cache of the user: what the resolution reads
	 */
	async metadata(): Promise<IPackageProviders> {
		if (this.#supplied) return this.#supplied;

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
		// The releases only the toolchain carries are added to what the registries publish
		this.#supplied = this.toolchain?.metadata(this.#metadata) ?? this.#metadata;
		return this.#supplied;
	}

	/**
	 * The transport of the fetch: the toolchain's archive addresses are answered from its archives
	 */
	carrier(next: SourcesTransport): SourcesTransport {
		return this.toolchain ? this.toolchain.transport(next) : next;
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
