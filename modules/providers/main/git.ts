import type { IPackageManifestResponse, IPackageProvider } from '@beyond-js/packages/providers/types';
import type { IPackageManifest } from '@beyond-js/packages/types';
import type { DependencyInfo } from '@beyond-js/packages/providers/dependency/info';
import type { IGitDependencyData } from '@beyond-js/packages/providers/dependency/parser';
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

	/** Build headers for a given host (auth if present). */
	#headers(dependency: DependencyInfo): Record<string, string> {
		const data = <IGitDependencyData>dependency.data;
		const { auth } = dependency.provider;
		return auth ? AuthHeaders.process(auth) : {};
	}

	/** Normalize and detect provider-specific raw URL for package.json */
	#url(host: string, owner: string, repo: string, ref = 'HEAD'): string {
		const h = host.replace(/^www\./, '').toLowerCase();

		// GitHub
		if (h === 'github.com') {
			return `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/package.json`;
		}
		// GitLab
		if (h === 'gitlab.com') {
			return `https://gitlab.com/${owner}/${repo}/-/raw/${ref}/package.json`;
		}
		// Bitbucket
		if (h === 'bitbucket.org') {
			return `https://bitbucket.org/${owner}/${repo}/raw/${ref}/package.json`;
		}
		// Fallback (may not work for all custom providers)
		return `https://${host}/${owner}/${repo}/raw/${ref}/package.json`;
	}

	/**
	 * Fetch package spec (package.json) from a git source via raw HTTP.
	 * - host: e.g. github.com, gitlab.com, bitbucket.org, or custom
	 * - owner/repo: the repository coordinates
	 * - ref: branch, tag or commit (defaults to HEAD)
	 */
	async manifest(dependency: DependencyInfo): Promise<IPackageManifestResponse> {
		const data = <IGitDependencyData>dependency.data;
		const { owner, repo } = data;
		const { hostname } = dependency.provider;
		const ref = data.ref ?? 'HEAD';
		const url = this.#url(hostname, owner, repo, ref);
		const headers = this.#headers(dependency);

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
	tarball(dependency: DependencyInfo): { url: string; headers: Record<string, string> } {
		const data = <IGitDependencyData>dependency.data;
		const { owner, repo } = data;
		const { hostname } = dependency.provider;
		const ref = data.ref ?? 'HEAD';

		const url: string = (() => {
			const h = hostname.replace(/^www\./, '').toLowerCase();

			if (h === 'github.com') {
				// codeload provides consistent tarballs
				return `https://codeload.github.com/${owner}/${repo}/tar.gz/${ref}`;
			} else if (h === 'gitlab.com') {
				// GitLab project archive (tar.gz)
				return `https://gitlab.com/${owner}/${repo}/-/archive/${ref}/${repo}-${ref}.tar.gz`;
			} else if (h === 'bitbucket.org') {
				// Bitbucket tarball
				return `https://bitbucket.org/${owner}/${repo}/get/${ref}.tar.gz`;
			} else {
				// Fallback (may vary per provider)
				return `https://${hostname}/${owner}/${repo}/archive/${ref}.tar.gz`;
			}
		})();

		const headers = this.#headers(dependency);
		return { url, headers };
	}
}
