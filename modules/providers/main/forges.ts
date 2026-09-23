import type { IGitDependencySource } from '@beyond-js/packages/dependency-source';

/**
 * The kinds of git hosting whose raw-file and archive endpoints are known
 */
export /*bundle*/ type ForgeKind = 'github' | 'gitlab' | 'bitbucket';

/**
 * Where one repository of a known kind of host serves the three things a resolution and a fetch need: its
 * references (the smart-HTTP advertisement every git host answers), the manifest of a commit and the archive of
 * a commit. It never clones.
 */
export class Forge {
	#kind: ForgeKind;
	#base: string;
	#host: string;
	#owner: string;
	#repo: string;

	get kind() {
		return this.#kind;
	}

	constructor(kind: ForgeKind, source: IGitDependencySource) {
		this.#kind = kind;
		this.#base = source.base;
		this.#host = source.baseurl;
		this.#owner = source.owner;
		this.#repo = source.repo;
	}

	/**
	 * The reference advertisement of the smart-HTTP protocol, which any git host answers
	 */
	get refs(): string {
		return `${this.#base}/${this.#owner}/${this.#repo}.git/info/refs?service=git-upload-pack`;
	}

	/**
	 * The `package.json` of the repository root at a commit
	 */
	manifest(commit: string): string {
		const repository = `${this.#base}/${this.#owner}/${this.#repo}`;
		if (this.#kind === 'gitlab') return `${repository}/-/raw/${commit}/package.json`;
		if (this.#kind === 'github' && this.#host === 'github.com') {
			return `https://raw.githubusercontent.com/${this.#owner}/${this.#repo}/${commit}/package.json`;
		}
		return `${repository}/raw/${commit}/package.json`;
	}

	/**
	 * The gzipped archive of the repository at a commit
	 */
	archive(commit: string): string {
		const repository = `${this.#base}/${this.#owner}/${this.#repo}`;
		if (this.#kind === 'gitlab') return `${repository}/-/archive/${commit}/${this.#repo}-${commit}.tar.gz`;
		if (this.#kind === 'bitbucket') return `${repository}/get/${commit}.tar.gz`;
		if (this.#host === 'github.com') return `https://codeload.github.com/${this.#owner}/${this.#repo}/tar.gz/${commit}`;
		return `${repository}/archive/${commit}.tar.gz`;
	}
}

/**
 * The hosts whose kind is known: github.com, gitlab.com and bitbucket.org, plus the hosts a consumer declares
 * (a self-hosted GitLab, a GitHub Enterprise server). Any other host has no known archive endpoint, and its
 * sources are `SOURCE_UNSUPPORTED`.
 */
export /*bundle*/ class Forges {
	static #known: Record<string, ForgeKind> = { 'github.com': 'github', 'gitlab.com': 'gitlab', 'bitbucket.org': 'bitbucket' };
	#declared: Map<string, ForgeKind> = new Map();

	/**
	 * @param declared Kind by host, with its port when it is not the default (`gitlab.acme.example`)
	 */
	constructor(declared: Record<string, ForgeKind> = {}) {
		for (const [host, kind] of Object.entries(declared || {})) {
			['github', 'gitlab', 'bitbucket'].includes(kind) && this.#declared.set(host.toLowerCase(), kind);
		}
	}

	of(source: IGitDependencySource): Forge | undefined {
		const kind = Forges.#known[source.baseurl] || this.#declared.get(source.baseurl);
		return kind ? new Forge(kind, source) : void 0;
	}
}
