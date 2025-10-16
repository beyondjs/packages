import type {
	IPackumentResponse,
	IPackageManifestResponse,
	IPackageProvider
} from '@beyond-js/packages/providers/types';
import type { DependencySourceProvider } from '@beyond-js/packages/dependency-source/provider';
import type { DependencySourceRelease } from '@beyond-js/packages/dependency-source/release';
import type { IProviderData } from '@beyond-js/packages/providers/settings/types';
import { DependencySourceIsType } from '@beyond-js/packages/dependency-source';
import { PackageRegistryFetcher } from './fetcher';
import { AuthHeaders } from './tools';

/**
 * Registry adapter for semver-based dependencies resolved against npm-compatible registries.
 */
export class SemverRegistry implements IPackageProvider {
	readonly #name = 'semver';
	get name(): string {
		return this.#name;
	}

	async packument?(dependency: DependencySourceProvider): Promise<IPackumentResponse> {
		const { source, provider } = dependency;
		const { package: pkg } = source;
		if (dependency.source.data.is !== DependencySourceIsType.Semver) {
			throw new Error('Packument can only be fetched on semver repository sources');
		}

		const { hostname } = provider;

		const url = `https://${hostname}/${encodeURIComponent(pkg)}`;
		const headers = AuthHeaders.process(provider.auth);
		return await PackageRegistryFetcher.packument({ url, headers });
	}

	async manifest(dependency: DependencySourceRelease): Promise<IPackageManifestResponse> {
		const { source, provider, release } = dependency;
		const { package: pkg } = source;
		const { is } = source.data;
		const { hostname } = provider;
		const headers = AuthHeaders.process(provider.auth);

		let url: string;
		if (source.data.is === DependencySourceIsType.Semver) {
			url = `https://${hostname}/${encodeURIComponent(pkg)}/${encodeURIComponent(release)}`;
		} else {
			throw new Error(`Source type "${is}" is not currently supported`);
		}

		return await PackageRegistryFetcher.manifest({ url, headers });
	}

	tarball(dependency: DependencySourceProvider, release: string): { url: string; headers: Record<string, string> } {
		const { package: pkg, name } = dependency.source;
		const { source, provider } = dependency;
		const { is } = source.data;
		const { hostname } = provider;
		const headers = AuthHeaders.process(provider.auth);

		let url: string;

		if (source.data.is === DependencySourceIsType.Semver) {
			url = `https://${hostname}/${encodeURIComponent(pkg)}/-/${name}.tgz`;
		} else {
			throw new Error(`Source type "${is}" is not currently supported`);
		}

		return { url, headers };
	}
}
