import type { IPackageManifest, IDiagnostic } from '@beyond-js/packages/types';
import type { IProviderIdentity, IPackageProviders } from '@beyond-js/packages/providers/types';
import { type DependencySource, DependencySourceIsType } from '@beyond-js/packages/dependency-source';

/**
 * What is known of the release an occurrence resolved to
 */
export /*bundle*/ interface INodeRelease {
	manifest?: IPackageManifest;
	provider?: IProviderIdentity;
	// The document the manifest was read from
	via?: 'packument' | 'manifest';
	// The archive of a release whose manifest does not publish one (a git commit)
	tarball?: string;
	// The integrity of an archive URL: the one it declares, or the one of its download when it declares none
	integrity?: string;
	// True when the archive URL declares no integrity and was downloaded once to pin it
	downloaded?: boolean;
}

/**
 * Obtains what the providers publish about one release. Only metadata is read: nothing is downloaded.
 */
export class Release implements INodeRelease {
	manifest?: IPackageManifest;
	provider?: IProviderIdentity;
	via?: 'packument' | 'manifest';
	tarball?: string;
	integrity?: string;
	downloaded?: boolean;

	/**
	 * @returns Why the release could not be described, if so
	 */
	async load(packages: IPackageProviders, source: DependencySource, version: string): Promise<IDiagnostic | void> {
		// The content of an archive URL is only known once fetched: its integrity is the declared one, or the one
		// its pinning download computed (the same download, answered once per resolution)
		const { data } = source;
		if (data.is === DependencySourceIsType.Url) {
			this.provider = typeof packages.describe === 'function' ? await packages.describe(source) : void 0;
			this.integrity = data.integrity;
			if (data.integrity !== void 0 || typeof packages.archive !== 'function') return;

			const { integrity, error } = await packages.archive(source);
			if (error) return error;
			Object.assign(this, { integrity, downloaded: true });
			return;
		}

		const { error, found, manifest, via, provider } = await packages.manifest(source, version);
		if (error) return error;
		if (!found || !manifest) {
			const code = 'PACKAGE_MANIFEST_UNAVAILABLE';
			return { code, message: `The manifest for package "${source.package}@${version}" is not available` };
		}
		Object.assign(this, { manifest, via, provider });

		// A registry publishes the archive of a release in its manifest; a git host does not
		if (source.data.is === DependencySourceIsType.Git) {
			this.tarball = (await packages.tarball(source, version)).url;
		}
	}
}
