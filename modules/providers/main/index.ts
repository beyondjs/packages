import type {
	IPackageManifestResponse,
	IPackageProvider,
	IPackageProviders,
	IPackumentResponse
} from '@beyond-js/packages/providers/types';
import type { IProvidersSettingsOptions } from '@beyond-js/packages/providers/settings';
import { ProvidersSettings } from '@beyond-js/packages/providers/settings';
import { DependencyInfo } from '@beyond-js/packages/providers/dependency/info';
import { DependencyIsType } from '@beyond-js/packages/providers/dependency/parser';
import { SemverRegistry } from './semver';
import { GitProvider } from './git';
import { PendingPromise } from '@beyond-js/pending-promise/main';

export /*bundle*/ interface IProvidersOptions extends IProvidersSettingsOptions {}

export /*bundle*/ class PackageProviders extends Map<string, IPackageProvider> implements IPackageProviders {
	#settings: ProvidersSettings;

	#semver: SemverRegistry;
	#git: GitProvider;

	#initialized = false;
	get initialized() {
		return this.#initialized;
	}

	#ready: PendingPromise<void>;
	get ready() {
		return this.#ready;
	}

	constructor(options: IProvidersOptions) {
		super();

		const ready = (error?: Error) => {
			if (error) console.error(error);
			error ? this.#ready.reject(error) : this.#ready.resolve();
		};

		this.#ready = new PendingPromise();
		this.#settings = new ProvidersSettings(options);
		this.#settings
			.load()
			.then(() => ready())
			.catch(ready);

		this.#semver = new SemverRegistry();
		this.#git = new GitProvider();

		this.set('semver', this.#semver);
		this.set('git', this.#git);
	}

	/**
	 * Retrieves the packument for a specific package (only for semver).
	 *
	 * @param pkg - Full package name, including scope if applicable (e.g., '@scope/package-name' or 'package-name').
	 * @returns
	 */
	async packument(pkg: string): Promise<IPackumentResponse> {
		await this.#ready;

		const dependency = new DependencyInfo(pkg, void 0, this.#settings);
		return await this.#semver.packument(dependency);
	}

	/**
	 * Retrieves the package specification for a specific version.
	 *
	 * @param pkg - Full package name, including scope if applicable (e.g., '@scope/package-name' or 'package-name').
	 * @param specifier - The version specifier as defined in package.json
	 * (e.g., '^1.0.0', 'latest', 'https://github.com/user/repo', 'https://my-domain.com/package.tgz').
	 * @param version - The specific version to retrieve.
	 */
	async manifest(pkg: string, specifier: string, version: string): Promise<IPackageManifestResponse> {
		await this.#ready;

		const dependency = new DependencyInfo(pkg, specifier, this.#settings);

		const { is } = dependency.data;
		switch (is) {
			case DependencyIsType.Semver:
				return await this.#semver.manifest(dependency, version);
			case DependencyIsType.Git:
				return await this.#git.manifest(dependency);
			case DependencyIsType.Url:
			// return this.#url.manifest(dependency.url!, logger);
			default:
				throw new Error(`Unsupported dependency type: ${is}`);
		}
	}

	/**
	 * Build a tarball request (url + headers) for downloading repository archive at a ref.
	 * This is optional but handy to keep symmetry with semver tarball usage.
	 */
	tarball(pkg: string, specifier: string, version: string): { url: string; headers: Record<string, string> } {
		if (!this.#initialized) {
			throw new Error('Providers not initialized. Await the ".ready" promise before using this method');
		}

		const dependency = new DependencyInfo(pkg, specifier, this.#settings);

		const { is } = dependency.data;
		switch (is) {
			case DependencyIsType.Semver:
				return this.#semver.tarball(dependency);
			case DependencyIsType.Git:
				return this.#git.tarball(dependency);
			case DependencyIsType.Url:
			// return this.#url.manifest(dependency.url!, logger);
			default:
				throw new Error(`Unsupported dependency type: ${is}`);
		}
	}
}
