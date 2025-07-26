import type { IGitIdentifier, INpmIdentifier, PackageIdentifierType } from '@beyond-js/packages/repositories/types';

export /*bundle*/ class PackageIdentifier {
	readonly #id: string;
	get id() {
		return this.#id;
	}

	readonly #path: string;
	get path() {
		return this.#path;
	}

	readonly #error?: { code: string; text: string };
	get error() {
		return this.#error;
	}

	constructor(id: PackageIdentifierType) {
		if (typeof id === 'string') {
			// If id is a string, it should be a tarball URL
			const url = id;
			const parsed = new URL(url);

			const file = parsed.pathname.split('/').pop();
			if (!file) throw new Error(`Invalid tarball URL: ${url}`);

			const fname = file.replace(/\.tgz$/, '');
			this.#id = `tarball:${parsed.hostname}/${fname}`;
			this.#path = `tarball/${parsed.hostname}/${fname}`;
		} else if ((<INpmIdentifier>id).name) {
			const npm = <INpmIdentifier>id;
			if (!npm.version || !npm.repository) {
				this.#error = {
					code: 'MISSING_NPM_INFO',
					text: `Missing version or repository in NPM identifier: ${JSON.stringify(npm)}`
				};
			}

			// Check for invalid scope format
			const parts = npm.name.split('/');
			if (npm.name.startsWith('@') && parts.length !== 2) {
				const code = 'INVALID_SCOPE';
				const text = `Invalid scope in package name "${npm.name}"`;
				this.#error = { code, text };
				return;
			}
			const scope = parts.length === 2 ? parts[0] : undefined;
			const name = scope ? parts[1] : parts[0];

			const { version, repository } = npm;

			this.#id = scope ? `${repository}:${scope}/${name}@${version}` : `${repository}/${name}@${version}`;
			this.#path = scope ? `${repository}/${scope}/${name}/${version}` : `${repository}/${name}/${version}`;
		} else if ((<IGitIdentifier>id).host) {
			const git = <IGitIdentifier>id;
			const { host, owner, repo, ref } = git;
			const reference = ref ?? 'HEAD';

			this.#id = `git:${host}/${owner}/${repo}@${reference}`;
			this.#path = `git/${host}/${owner}/${repo}/${reference}`;
		} else {
			this.#error = {
				code: 'INVALID_IDENTIFIER',
				text: `Invalid package identifier: ${JSON.stringify(id)}`
			};
		}
	}
}
