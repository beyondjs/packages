import type { DependencyInfo } from './';
import { InfoIsType } from './types';

export /*bundle*/ class PackageIdentifier {
	readonly #id: string;
	get id() {
		return this.#id;
	}

	readonly #path: string;
	get path() {
		return this.#path;
	}

	constructor(info: DependencyInfo) {
		if (info.data.is === InfoIsType.Error) return;

		if (info.data.is === InfoIsType.Url) {
			const { fname, hostname } = info.data;

			this.#id = `tarball:${hostname}/${fname}`;
			this.#path = `tarball/${hostname}/${fname}`;
		} else if (info.data.is === InfoIsType.Semver) {
			const { package: name, scope } = info;

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
