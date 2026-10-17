import type {
	IPackageProviders,
	IPackageVersionsResponse,
	IPackageManifestResponse,
	IPackageTarballResponse,
	IPackumentResponse,
	IProviderIdentity
} from '@beyond-js/packages/providers/types';
import type { DependencySource } from '@beyond-js/packages/dependency-source';
import type { ISuppliedRelease, ToolchainCatalog } from './catalog';
import { DependencySourceIsType } from '@beyond-js/packages/dependency-source';
import { ToolchainAddress } from './address';

/**
 * The metadata of an installation with the releases only the toolchain carries added: what the resolution reads.
 *
 * - A registry that publishes a name keeps every release it publishes; the toolchain adds only the versions the
 *   registry does not publish, so a release with one name and version always has one source, the registry's when it
 *   has one.
 * - A registry that does not know a name (not found) is answered with the toolchain's releases of that name, when it
 *   carries any; otherwise the registry's answer stands.
 * - A registry that fails (unreachable, refused) keeps its error: an outage is never hidden behind the toolchain, so
 *   the graph resolved offline from the toolchain never differs silently from the one resolved online.
 * - A supplied release is described by its archive's manifest, with `dist` naming its toolchain address and the
 *   integrity of the archive, and by the provider `toolchain`, public.
 */
export class SuppliedMetadata implements IPackageProviders {
	static #IDENTITY: IProviderIdentity = { registry: ToolchainAddress.PROVIDER, visibility: 'public' };

	#registries: IPackageProviders;
	#catalog: ToolchainCatalog;

	constructor(registries: IPackageProviders, catalog: ToolchainCatalog) {
		this.#registries = registries;
		this.#catalog = catalog;
	}

	/**
	 * The manifest of a supplied release as the resolution reads it
	 */
	static #manifest(release: ISuppliedRelease): Record<string, any> {
		const dist = { tarball: ToolchainAddress.compose(release.name, release.version), integrity: release.integrity };
		return { ...release.manifest, dist };
	}

	/**
	 * The versions only the toolchain carries for a name, given what the registry answered
	 */
	async #added(name: string, published: string[] | undefined): Promise<ISuppliedRelease[]> {
		const supplied = await this.#catalog.versions(name);
		const known = new Set(published ?? []);
		return [...supplied.values()].filter(({ version }) => !known.has(version));
	}

	/**
	 * The registry's package document of a name, as it answered: whether it was found, and its versions
	 */
	async #published(name: string): Promise<{ response: IPackumentResponse; versions?: string[] }> {
		const response = this.#registries.packument
			? await this.#registries.packument(name)
			: await this.#versions(name);
		const listed = response.packument?.versions;
		const versions = response.found && listed && typeof listed === 'object' ? Object.keys(listed) : void 0;
		return { response, versions };
	}

	async #versions(name: string): Promise<IPackumentResponse> {
		const answer = await this.#registries.versions?.(name);
		if (!answer) return { found: false };
		if (answer.error || !answer.found) return { error: answer.error, found: answer.found };
		const versions: Record<string, object> = {};
		(answer.versions ?? []).forEach(version => (versions[version] = {}));
		return { found: true, packument: <any>{ name, versions } };
	}

	async packument(name: string): Promise<IPackumentResponse> {
		const { response, versions } = await this.#published(name);
		if (response.error) return response;

		const added = await this.#added(name, versions);
		if (!added.length) return response;

		const found = response.found ? response.packument : <any>{ name, 'dist-tags': {}, versions: {} };
		const listed = { ...(found.versions ?? {}) };
		added.forEach(release => (listed[release.version] = SuppliedMetadata.#manifest(release)));
		return { found: true, packument: { ...found, versions: listed } };
	}

	async versions(name: string): Promise<IPackageVersionsResponse> {
		const { error, found, packument } = await this.packument(name);
		if (error || !found) return { error, found };
		return { found: true, versions: Object.keys(packument?.versions ?? {}) };
	}

	/**
	 * The release the toolchain supplies for a source, when the registry does not publish it
	 */
	async #supplied(source: DependencySource, release: string): Promise<ISuppliedRelease | undefined> {
		if (source.target.data.is !== DependencySourceIsType.Semver) return;
		const name = source.target.package;
		if (!(await this.#catalog.release(name, release))) return;

		const { response, versions } = await this.#published(name);
		if (response.error) return;
		return (await this.#added(name, versions)).find(({ version }) => version === release);
	}

	async manifest(source: DependencySource, release: string): Promise<IPackageManifestResponse> {
		const supplied = await this.#supplied(source, release);
		if (!supplied) return await this.#registries.manifest(source, release);
		return { found: true, manifest: <any>SuppliedMetadata.#manifest(supplied), via: 'packument', provider: SuppliedMetadata.#IDENTITY };
	}

	async describe(source: DependencySource): Promise<IProviderIdentity> {
		return await this.#registries.describe?.(source);
	}

	async commit(source: DependencySource) {
		return await this.#registries.commit?.(source);
	}

	async archive(source: DependencySource) {
		return await this.#registries.archive?.(source);
	}

	async tarball(source: DependencySource, release: string): Promise<IPackageTarballResponse> {
		const supplied = await this.#supplied(source, release);
		if (!supplied) return await this.#registries.tarball(source, release);

		const url = ToolchainAddress.compose(supplied.name, supplied.version);
		return { url, integrity: supplied.integrity, provider: SuppliedMetadata.#IDENTITY };
	}
}
