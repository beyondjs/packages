import type { IPackageManifestResponse, IPackageProvider } from '@beyond-js/packages/providers/types';
import type { IPackageManifest } from '@beyond-js/packages/types';
import type { DependencySourceProvider } from '@beyond-js/packages/dependency-source/provider';
import type { DependencySourceRelease } from '@beyond-js/packages/dependency-source/release';
import { DependencySourceIsType } from '@beyond-js/packages/dependency-source';
import { AuthHeaders } from './tools';

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
	async manifest(dependency: DependencySourceRelease): Promise<IPackageManifestResponse> {
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

		const headers = AuthHeaders.process(provider.auth);

		let response: Response;
		try {
			response = await fetch(url, { headers });
		} catch (exc) {
			const code = 'NETWORK_ERROR';
			const message = 'Network error occurred';
			return { error: { code, message } };
		}

		if (response.status === 404) {
			return { found: false };
		}

		if (!response.ok) {
			const code = 'INVALID_PROVIDER_RESPONSE';
			const message = `Invalid response from provider: ${response.status}`;
			return { error: { code, message } };
		}

		try {
			const manifest: IPackageManifest = await response.json();
			return { manifest };
		} catch (exc) {
			const code = 'PROVIDER_RESPONSE_NOT_PARSABLE';
			const message = 'The provider response could not be parsed as JSON';
			return { error: { code, message } };
		}
	}

	/**
	 * Build a tarball request (url + headers) for downloading repository archive at a ref.
	 * This is optional but handy to keep symmetry with semver tarball usage.
	 */
	tarball(dependency: DependencySourceProvider, release: string): { url: string; headers: Record<string, string> } {
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
