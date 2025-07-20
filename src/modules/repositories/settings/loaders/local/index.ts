import type { RepositoryAuthType } from '@beyond-js/packages/repositories/types';
import type { IRepositorySettings } from '../../types';
import { LocalSettingsFiles } from './files';

/**
 * Load registry and scope configurations from local .npmrc files.
 */
export class LocalLoader implements IRepositorySettings {
	// Scopes to registry mapping: the key is the scope and the value is the repository host
	#scopes: Map<string, string> = new Map();
	get scopes() {
		return this.#scopes;
	}

	// The hosts map: the key is the host and the value is the repository auth type
	#hosts: Map<string, RepositoryAuthType> = new Map();
	get hosts() {
		return this.#hosts;
	}

	// The default repository host
	#default: { host: string; auth?: RepositoryAuthType } = { host: 'registry.npmjs.org' };
	get default() {
		return this.#default;
	}

	#normalize(url: string): string {
		return url.replace(/^https?:\/\//, '').replace(/\/+$/, '');
	}

	async process(pkg: string, workspace?: string): Promise<void> {
		const files = new LocalSettingsFiles(pkg, workspace);
		await files.process();

		for (const [, { content, origin }] of files) {
			const lines = content
				.split('\n')
				.map(line => line.trim())
				.filter(Boolean);

			for (const line of lines) {
				if (line.startsWith('#') || line.startsWith(';')) continue;

				let match: RegExpMatchArray | null;

				// 1. Scope to registry mapping: @scope:registry=https://host/
				match = line.match(/^(@[^:]+):registry=(.+)$/);
				if (match) {
					const [, scope, url] = match;
					const host = this.#normalize(url);
					this.#scopes.set(scope, host);
					continue;
				}

				// 2. Auth Token: //host/:_authToken=token
				match = line.match(/^\/\/([^/]+)\/?:_authToken=(.+)$/);
				if (match) {
					const [, host, token] = match;
					this.#hosts.set(host, { mode: 'token', token, origin });
					continue;
				}

				// 3. Basic auth: _auth=base64 (applies to default host)
				match = line.match(/^_auth=(.+)$/);
				if (match) {
					const token = match[1];
					this.#default.auth = { mode: 'basic', token, origin };
					continue;
				}

				// 4. Auth token for default host: _authToken=token
				match = line.match(/^_authToken=(.+)$/);
				if (match) {
					const token = match[1];
					this.#default.auth = { mode: 'token', token, origin };
					continue;
				}

				// 5. User/pass auth: username=token (applies to default host)
				match = line.match(/^username=(.+)$/);
				if (match) {
					const user = match[1];
					const passLine = lines.find(l => l.startsWith('password='));
					if (passLine) {
						const [, password] = passLine.split(/=(.+)/);
						this.#default.auth = { mode: 'user-pass', user, token: password, origin };
					}
					continue;
				}

				// 6. User/pass auth: username + password for specific host
				match = line.match(/^\/\/([^/]+)\/?:username=(.+)$/);
				if (match) {
					const [, host, user] = match;
					const passLine = lines.find(l => l.startsWith(`//${host}/:password=`));
					if (!passLine) continue;

					// Extract the password part even if it contains '=' characters
					const [, password] = passLine.split(/=(.+)/);
					this.#hosts.set(host, { mode: 'user-pass', user, token: password, origin: origin });
				}

				// 7. Default registry override: registry=https://host/
				match = line.match(/^registry=(.+)$/);
				if (match) {
					const url = match[1];
					const host = this.#normalize(url);
					this.#default.host = host;
					continue;
				}
			}
		}
	}
}
