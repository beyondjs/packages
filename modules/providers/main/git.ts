import type {
	IPackageManifestResponse,
	IPackageCommitResponse,
	IPackageProvider,
	ICacheOptions
} from '@beyond-js/packages/providers/types';
import type { DependencySourceProvider } from '@beyond-js/packages/dependency-source/provider';
import type { DependencySourceRelease } from '@beyond-js/packages/dependency-source/release';
import type { DependencySource, IGitDependencySource } from '@beyond-js/packages/dependency-source';
import { DependencySourceIsType } from '@beyond-js/packages/dependency-source';
import { type ITarballRequest, AuthHeaders } from './tools';
import { type Transport, PackageRegistryFetcher } from './fetcher';
import { type Forge, Forges } from './forges';
import { GitReferences } from './refs';

/**
 * The largest reference advertisement read to pin a branch or a tag: repositories with many references
 * advertise megabytes, and one that exceeds this is refused instead of read without bound
 */
const ADVERTISEMENT = 16 * 1024 * 1024;

/**
 * Provider adapter for git-based dependencies.
 *
 * - Does not clone repositories.
 * - A release is always a full commit: a branch or a tag is pinned through the smart-HTTP reference
 *   advertisement of the repository, which any git host answers.
 * - The manifest and the archive of a commit are requested from the raw-file and archive endpoints of a known
 *   kind of host (GitHub, GitLab, Bitbucket, and hosts declared as one of them). Any other host is
 *   `SOURCE_UNSUPPORTED`: nothing is ever requested from an endpoint that was guessed.
 */
export class GitProvider implements IPackageProvider {
	readonly #name = 'git';
	get name(): string {
		return this.#name;
	}

	#transport?: Transport;
	#forges: Forges;

	constructor(transport?: Transport, forges?: Forges) {
		this.#transport = transport;
		this.#forges = forges || new Forges();
	}

	/**
	 * The known kind of host of a source, or why there is none
	 */
	#forge(source: DependencySource): { forge?: Forge; error?: { code: string; message: string } } {
		if (source.data.is !== DependencySourceIsType.Git) throw new Error(`Source type must be 'git'`);
		const forge = this.#forges.of(source.data);
		if (forge) return { forge };

		const code = 'SOURCE_UNSUPPORTED';
		const message = `The git host "${source.data.baseurl}" is not a known kind of host (GitHub, GitLab, Bitbucket): its archives cannot be requested`;
		return { error: { code, message } };
	}

	/**
	 * Pins the reference of the source to a full commit
	 */
	async commit(dependency: DependencySourceProvider): Promise<IPackageCommitResponse> {
		const { source, provider } = dependency;
		const { forge, error } = this.#forge(source);
		if (error) return { error };

		const { owner, repo, ref, pinned } = <IGitDependencySource>source.data;
		if (pinned) return { commit: ref.toLowerCase() };
		if (ref && /^[0-9a-f]{7,39}$/i.test(ref)) {
			const code = 'GIT_REFERENCE_NOT_FOUND';
			const message = `"${ref}" looks like an abbreviated commit of "${owner}/${repo}": declare the full commit`;
			return { error: { code, message } };
		}

		// Credentials belong to the declared host: they reach the advertisement only when it is under it
		const url = forge.refs;
		const headers = AuthHeaders.within(provider, url);
		const r = await PackageRegistryFetcher.fetch({ url, headers, text: true, limit: ADVERTISEMENT, transport: this.#transport });
		if (r.error) return { error: r.error };

		const commit = r.found ? new GitReferences(r.document).commit(ref) : void 0;
		if (!commit) {
			const code = 'GIT_REFERENCE_NOT_FOUND';
			const message = `The reference "${ref || 'HEAD'}" of "${owner}/${repo}" could not be pinned to a commit`;
			return { error: { code, message } };
		}
		return { commit };
	}

	/**
	 * Fetch the manifest of a commit via raw HTTP. The release of the dependency is the commit.
	 */
	async manifest(dependency: DependencySourceRelease, cache?: ICacheOptions): Promise<IPackageManifestResponse> {
		const { source, provider, release } = dependency;
		const { forge, error } = this.#forge(source);
		if (error) return { error };

		// Credentials belong to the declared host: the raw content host of GitHub is a different one
		const url = forge.manifest(release);
		const headers = AuthHeaders.within(provider, url);

		const r = await PackageRegistryFetcher.fetch({ url, headers, cache, transport: this.#transport });
		if (r.notmodified) return { found: true, notmodified: true };
		return { error: r.error, found: r.found, manifest: r.document, cache: r.cache };
	}

	/**
	 * Build a tarball request (url + headers) for downloading the repository archive at a commit.
	 */
	async tarball(dependency: DependencySourceRelease): Promise<ITarballRequest> {
		const { source, provider, release } = dependency;
		const { forge, error } = this.#forge(source);
		if (error) return { error };

		const url = forge.archive(release);
		return { url, headers: AuthHeaders.within(provider, url) };
	}
}
