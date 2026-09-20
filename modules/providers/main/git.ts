import type {
	IPackageManifestResponse,
	IPackageCommitResponse,
	IPackageProvider,
	ICacheOptions
} from '@beyond-js/packages/providers/types';
import type { DependencySourceProvider } from '@beyond-js/packages/dependency-source/provider';
import type { DependencySourceRelease } from '@beyond-js/packages/dependency-source/release';
import { DependencySourceIsType } from '@beyond-js/packages/dependency-source';
import { type ITarballRequest, AuthHeaders } from './tools';
import { PackageRegistryFetcher } from './fetcher';

/**
 * Provider adapter for git-based dependencies.
 *
 * - Does not clone repositories.
 * - A release is always a commit: a branch or tag is pinned through the metadata API of the provider,
 *   and a provider without a known API is refused unless the reference already is a full commit hash.
 * - Resolves package.json via provider raw HTTP endpoints (GitHub/GitLab/Bitbucket).
 */
export class GitProvider implements IPackageProvider {
	readonly #name = 'git';
	get name(): string {
		return this.#name;
	}

	/**
	 * Pins the reference of the source to a commit hash
	 */
	async commit(dependency: DependencySourceProvider): Promise<IPackageCommitResponse> {
		const { source, provider } = dependency;
		if (source.data.is !== DependencySourceIsType.Git) throw new Error(`Source type must be 'git'`);

		const { owner, repo, ref, pinned, baseurl } = source.data;
		if (pinned) return { commit: ref.toLowerCase() };

		if (baseurl !== 'github.com') {
			const code = 'SOURCE_UNSUPPORTED';
			const message =
				`The git host "${baseurl}" has no supported metadata API to pin "${ref || 'the default branch'}" ` +
				`to a commit: declare a full commit hash as the reference`;
			return { error: { code, message } };
		}

		// The commits endpoint answers the hash alone for this media type
		const url = `https://api.github.com/repos/${owner}/${repo}/commits/${encodeURIComponent(ref || 'HEAD')}`;
		const headers = { ...AuthHeaders.process(provider.auth), Accept: 'application/vnd.github.sha' };
		const r = await PackageRegistryFetcher.fetch({ url, headers, text: true });

		if (r.error) return { error: r.error };
		if (!r.found || !/^[0-9a-f]{40}$/i.test(r.document)) {
			const code = 'GIT_REFERENCE_NOT_FOUND';
			const message = `The reference "${ref || 'HEAD'}" of "${owner}/${repo}" could not be pinned to a commit`;
			return { error: { code, message } };
		}
		return { commit: r.document.toLowerCase() };
	}

	/**
	 * Fetch the manifest of a commit via raw HTTP. The release of the dependency is the commit.
	 */
	async manifest(dependency: DependencySourceRelease, cache?: ICacheOptions): Promise<IPackageManifestResponse> {
		const { source, provider, release } = dependency;
		if (source.data.is !== DependencySourceIsType.Git) throw new Error(`Source type must be 'git'`);

		const { owner, repo, baseurl } = source.data;

		let url: string;
		if (baseurl === 'github.com') {
			url = `https://raw.githubusercontent.com/${owner}/${repo}/${release}/package.json`;
		} else if (baseurl === 'gitlab.com') {
			url = `https://gitlab.com/${owner}/${repo}/-/raw/${release}/package.json`;
		} else if (baseurl === 'bitbucket.org') {
			url = `https://bitbucket.org/${owner}/${repo}/raw/${release}/package.json`;
		} else {
			// Convention shared by self-hosted forges; a host that differs answers not found
			url = `${provider.base}/${owner}/${repo}/raw/${release}/package.json`;
		}

		// Credentials belong to the declared host: the raw content host of GitHub is a different one
		const headers = AuthHeaders.within(provider, url);

		const r = await PackageRegistryFetcher.fetch({ url, headers, cache });
		if (r.notmodified) return { found: true, notmodified: true };
		return { error: r.error, found: r.found, manifest: r.document, cache: r.cache };
	}

	/**
	 * Build a tarball request (url + headers) for downloading the repository archive at a commit.
	 */
	async tarball(dependency: DependencySourceRelease): Promise<ITarballRequest> {
		const { source, provider, release } = dependency;
		if (source.data.is !== DependencySourceIsType.Git) throw new Error(`Source type must be 'git'`);

		const { owner, repo, baseurl } = source.data;

		let url: string;
		if (baseurl === 'github.com') {
			// codeload provides consistent tarballs
			url = `https://codeload.github.com/${owner}/${repo}/tar.gz/${release}`;
		} else if (baseurl === 'gitlab.com') {
			url = `https://gitlab.com/${owner}/${repo}/-/archive/${release}/${repo}-${release}.tar.gz`;
		} else if (baseurl === 'bitbucket.org') {
			url = `https://bitbucket.org/${owner}/${repo}/get/${release}.tar.gz`;
		} else {
			url = `${provider.base}/${owner}/${repo}/archive/${release}.tar.gz`;
		}

		return { url, headers: AuthHeaders.within(provider, url) };
	}
}
