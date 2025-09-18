import type { IRegistry, IPackageSpecResponse } from './types';
import type { Logger } from '@beyond-js/packages/logs';
import type { ProvidersSettings } from '@beyond-js/packages/providers/settings';
import type { IProviderAuth } from '@beyond-js/packages/providers/types';
import type { DependencyResolution } from '@beyond-js/packages/dependencies/resolution';
import { ProvidersResponse } from '@beyond-js/packages/providers/response';
import { InvalidRegistryResponse, RegistryResponseCouldNotBeParsed } from '@beyond-js/packages/providers/errors';
import { AuthHeaders } from './tools';

/**
 * Registry adapter for git-based dependencies.
 *
 * - Does not clone repositories.
 * - Resolves package.json via provider raw HTTP endpoints (GitHub/GitLab/Bitbucket).
 * - Auth/headers are resolved per request from ProvidersSettings.
 */
export class GitProvider implements IRegistry {
	#settings: ProvidersSettings;

	readonly #name = 'git';
	get name(): string {
		return this.#name;
	}

	constructor(settings: ProvidersSettings) {
		this.#settings = settings;
	}

	/** Resolve auth for a given host from settings (host-specific first, then default). */
	#auth(host: string): IProviderAuth | undefined {
		return this.#settings.hosts.get(host) ?? this.#settings.default?.auth;
	}

	/** Build headers for a given host (auth if present). */
	#headers(host: string): Record<string, string> {
		const auth = this.#auth(host);
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
	async spec(dependency: DependencyResolution, logger?: Logger): Promise<ProvidersResponse<IPackageSpecResponse>> {
		const { host, owner, repo: repoName } = dependency;
		const ref = repo.ref ?? 'HEAD';
		const url = this.#url(repo.host, repo.owner, repo.repo, ref);
		const headers = this.#headers(repo.host);

		let response: Response;
		try {
			response = await fetch(url, { headers });
		} catch (exc) {
			logger?.error(exc);
			return new ProvidersResponse({ error: new InvalidRegistryResponse(0) });
		}

		if (response.status === 404) {
			const notFound: IPackageSpecResponse = {
				host: repo.host,
				name: repo.repo,
				version: ref,
				found: false
			};
			return new ProvidersResponse({ data: notFound });
		}

		if (!response.ok) {
			return new ProvidersResponse({ error: new InvalidRegistryResponse(response.status) });
		}

		try {
			const value = await response.json();
			const ok: IPackageSpecResponse = {
				host: repo.host,
				name: repo.repo,
				version: ref,
				found: true,
				valid: true,
				value
			};
			return new ProvidersResponse({ data: ok });
		} catch (exc) {
			logger?.error(exc);
			const bad: IPackageSpecResponse = {
				host: repo.host,
				name: repo.repo,
				version: ref,
				found: true,
				valid: false,
				error: new RegistryResponseCouldNotBeParsed()
			};
			return new ProvidersResponse({ data: bad });
		}
	}

	/**
	 * Build a tarball request (url + headers) for downloading repository archive at a ref.
	 * This is optional but handy to keep symmetry with semver tarball usage.
	 */
	tarball(dependency: DependencyResolution) {
		const { host, owner, repo: repoName, ref = 'HEAD' } = dependency;

		const ref = repo.ref ?? 'HEAD';
		const h = repo.host.replace(/^www\./, '').toLowerCase();
		let url: string;

		if (h === 'github.com') {
			// codeload provides consistent tarballs
			url = `https://codeload.github.com/${repo.owner}/${repo.repo}/tar.gz/${ref}`;
		} else if (h === 'gitlab.com') {
			// GitLab project archive (tar.gz)
			url = `https://gitlab.com/${repo.owner}/${repo.repo}/-/archive/${ref}/${repo.repo}-${ref}.tar.gz`;
		} else if (h === 'bitbucket.org') {
			// Bitbucket tarball
			url = `https://bitbucket.org/${repo.owner}/${repo.repo}/get/${ref}.tar.gz`;
		} else {
			// Fallback (may vary per provider)
			url = `https://${repo.host}/${repo.owner}/${repo.repo}/archive/${ref}.tar.gz`;
		}

		return { url, headers: this.#headers(repo.host) };
	}
}
