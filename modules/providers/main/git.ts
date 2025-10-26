import type { IPackageManifestResponse, IPackageProvider, ICacheOptions } from '@beyond-js/packages/providers/types';
import type { DependencySourceProvider } from '@beyond-js/packages/dependency-source/provider';
import type { DependencySourceRelease } from '@beyond-js/packages/dependency-source/release';
import { DependencySourceIsType } from '@beyond-js/packages/dependency-source';
import { AuthHeaders } from './tools';
import { PackageRegistryFetcher } from './fetcher';

/**
 * Provider adapter for git-based dependencies.
 *
 * - Does not clone repositories.
 * - Resolves package.json via provider raw HTTP endpoints (GitHub/GitLab/Bitbucket).
 * - Auth/headers are resolved per request from ProvidersSettings.
 */
export class GitProvider implements IPackageProvider {
	readonly #name = 'git';
	get name(): string {
		return this.#name;
	}

	/**
	 * Fetch from a git source via raw HTTP.
	 *
	 * - host: e.g. github.com, gitlab.com, bitbucket.org, or custom
	 * - owner/repo: the repository coordinates
	 * - ref: branch, tag or commit (defaults to HEAD)
	 */
	async manifest(dependency: DependencySourceRelease, cache?: ICacheOptions): Promise<IPackageManifestResponse> {
		const { source, provider } = dependency;
		if (source.data.is !== DependencySourceIsType.Git) throw new Error(`Source type must be 'git'`);

		const { hostname, base } = provider;
		const { owner, repo } = source.data;
		const ref = source.data.ref || 'HEAD';

		let url: string;
		if (base === 'github.com') {
			// GitHub
			url = `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/package.json`;
		} else if (base === 'gitlab.com') {
			// GitLab
			url = `https://gitlab.com/${owner}/${repo}/-/raw/${ref}/package.json`;
		} else if (base === 'bitbucket.org') {
			// Bitbucket
			url = `https://bitbucket.org/${owner}/${repo}/raw/${ref}/package.json`;
		} else {
			// Fallback (may not work for all custom providers)
			url = `https://${hostname}/${owner}/${repo}/raw/${ref}/package.json`;
		}

		// Prepare headers
		const headers = AuthHeaders.process(provider.auth);

		// Set cache headers
		if (cache) {
			headers['If-None-Match'] = cache.etag;
			headers['If-Modified-Since'] = cache.lastModified;
		}

		const r = await PackageRegistryFetcher.fetch({ url, headers, cache });
		if (r.notmodified) return { found: true, notmodified: true };
		return { error: r.error, found: r.found, manifest: r.document, cache: r.cache };
	}

	/**
	 * Build a tarball request (url + headers) for downloading repository archive at a ref.
	 * This is optional but handy to keep symmetry with semver tarball usage.
	 */
	async tarball(dependency: DependencySourceRelease): Promise<{ url: string; headers: Record<string, string> }> {
		const { source, provider } = dependency;
		if (source.data.is !== DependencySourceIsType.Git) throw new Error(`Source type must be 'git'`);

		const { hostname, base } = provider;
		const { owner, repo } = source.data;
		const ref = source.data.ref || 'HEAD';

		let url: string;
		if (base === 'github.com') {
			// codeload provides consistent tarballs
			url = `https://codeload.github.com/${owner}/${repo}/tar.gz/${ref}`;
		} else if (base === 'gitlab.com') {
			// GitLab project archive (tar.gz)
			url = `https://gitlab.com/${owner}/${repo}/-/archive/${ref}/${repo}-${ref}.tar.gz`;
		} else if (base === 'bitbucket.org') {
			// Bitbucket tarball
			url = `https://bitbucket.org/${owner}/${repo}/get/${ref}.tar.gz`;
		} else {
			// Fallback (may vary per provider)
			url = `https://${hostname}/${owner}/${repo}/archive/${ref}.tar.gz`;
		}

		const headers = AuthHeaders.process(provider.auth);
		return { url, headers };
	}
}
