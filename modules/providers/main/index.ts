import type {
	IPackageManifestResponse,
	IPackageProvider,
	IPackageProviders,
	IPackumentResponse,
	IPackageTarballResponse,
	ICacheOptions
} from '@beyond-js/packages/providers/types';
import type { IProvidersSettingsOptions } from '@beyond-js/packages/providers/settings';
import { DependencySource } from '@beyond-js/packages/dependency-source';
import { ProvidersSettings } from '@beyond-js/packages/providers/settings';
import { DependencySourceProvider } from '@beyond-js/packages/dependency-source/provider';
import { DependencySourceRelease } from '@beyond-js/packages/dependency-source/release';
import { DependencySourceIsType } from '@beyond-js/packages/dependency-source';
import { SemverRegistry } from './semver';
import { GitProvider } from './git';
import { PendingPromise } from '@beyond-js/pending-promise/main';

export /*bundle*/ interface IProvidersOptions extends IProvidersSettingsOptions {}

export /*bundle*/ class PackageProviders extends Map<string, IPackageProvider> implements IPackageProviders {
	#settings: ProvidersSettings;
	get settings() {
		return this.#settings;
	}

	#semver: SemverRegistry;
	#git: GitProvider;

	#initialized = false;
	get initialized() {
		return this.#initialized;
	}

	/**
	 * Promise that resolves when the providers are ready to be used
	 * This is useful for ensuring that all provider settings are loaded before making requests.
	 */
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
	async packument(pkg: string, cache?: ICacheOptions): Promise<IPackumentResponse> {
		// Wait until providers are ready (settings are loaded)
		await this.#ready;

		const source = new DependencySource(pkg, '0.0.0');
		const dependency = new DependencySourceProvider(source, this.#settings);
		return await this.#semver.packument(dependency, cache);
	}

	/**
	 * Retrieves the package specification for a specific version.
	 *
	 * @param source - Package source specification
	 * @param release - Package release version
	 */
	async manifest(
		source: DependencySource,
		release: string,
		cache?: ICacheOptions
	): Promise<IPackageManifestResponse> {
		// Wait until providers are ready (settings are loaded)
		await this.#ready;

		const provider = new DependencySourceProvider(source, this.#settings);
		const dependency = new DependencySourceRelease(provider, release);

		const { is } = source.data;
		switch (is) {
			case DependencySourceIsType.Semver:
				return await this.#semver.manifest(dependency, cache);
			case DependencySourceIsType.Git:
				return await this.#git.manifest(dependency, cache);
			case DependencySourceIsType.Url:
			// return this.#url.manifest(dependency.url!, logger);
			default:
				throw new Error(`Unsupported dependency type: ${is}`);
		}
	}

	/**
	 * Build a tarball request (url + headers) for downloading package release archive
	 *
	 * @param source - Package source specification
	 * @param release - Package release version (only for semver)
	 */
	async tarball(source: DependencySource, release: string): Promise<IPackageTarballResponse> {
		// Wait until providers are ready (settings are loaded)
		await this.#ready;

		const provider = new DependencySourceProvider(source, this.#settings);
		const dependency = new DependencySourceRelease(provider, release);

		const done = ({ url, headers }: { url: string; headers: Record<string, string> }) => {
			const { id, path } = dependency;
			return { id, path, url, headers };
		};

		const { is } = source.data;
		switch (is) {
			case DependencySourceIsType.Semver:
				return done(await this.#semver.tarball(dependency));
			case DependencySourceIsType.Git:
				return done(await this.#git.tarball(dependency));
			case DependencySourceIsType.Url:
			// return this.#url.manifest(dependency.url!, logger);
			default:
				throw new Error(`Unsupported dependency type: ${is}`);
		}
	}
}
