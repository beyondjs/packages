import type {
	IProvidersSettings,
	IProviderData,
	IProviderAuthData
} from '@beyond-js/packages/providers/settings/types';
import { def } from '../../default';
import { LocalSettingsFiles } from './files';
import { TokenTools } from './tools';

/**
 * Load registry and scope configurations from local .npmrc files.
 */
export class LocalLoader implements IProvidersSettings {
	#scopes: Map<string, IProviderData> = new Map();
	get scopes() {
		return this.#scopes;
	}
	#hosts: Map<string, IProviderData> = new Map();
	get hosts() {
		return this.#hosts;
	}
	#default: IProviderData = def;
	get default() {
		return this.#default;
	}

	async load(pkg: string, workspace?: string): Promise<void> {
		const files = new LocalSettingsFiles(pkg, workspace);
		await files.process();

		const scopes: Map<string, string> = new Map();
		const hosts: Map<string, IProviderAuthData> = new Map();

		for (const [, { content, origin }] of files) {
			if (!content) continue;

			const lines = content
				.split('\n')
				.map(line => line.trim())
				.filter(Boolean);

			for (const line of lines) {
				if (line.startsWith('#') || line.startsWith(';')) continue;

				let match: RegExpMatchArray | null;

				// 1. Default Registry Base URL: registry=https://host/
				match = line.match(/^registry=(.+)$/);
				if (match) {
					const url = match[1];
					this.#default.base = url;
					this.#default.hostname = url.replace(/^https?:\/\//, '');
				}

				// 2. Default Registry Auth Token: _authToken=token
				match = line.match(/^_authToken=(.+)$/);
				if (match) {
					const token = TokenTools.clean(match[1]);
					this.#default.origin = origin;
					this.#default.auth = { mode: 'token', token };
					continue;
				}

				// 3. Default Registry Basic Auth: _auth=base64
				match = line.match(/^_auth=(.+)$/);
				if (match) {
					const token = TokenTools.clean(match[1]);
					this.#default.auth = { mode: 'basic', token };
					continue;
				}

				// 4. Default Registry User/pass Auth: username=token
				match = line.match(/^username=(.+)$/);
				if (match) {
					const user = match[1];
					const passLine = lines.find(l => l.startsWith('password='));
					if (passLine) {
						const [, password] = passLine.split(/=(.+)/);
						this.#default.origin = origin;
						this.#default.auth = { mode: 'user-pass', user, token: password };
					}
					continue;
				}

				// 4. Scope to registry mapping: @scope:registry=https://host/
				match = line.match(/^(@[^:]+):registry=(.+)$/);
				if (match) {
					const [, scope, base] = match;
					scopes.set(scope, base);
					continue;
				}

				// 5. Host-specific auth token: //host/:_authToken=token
				match = line.match(/^\/\/([^/]+)\/?:_authToken=(.+)$/);
				if (match) {
					const [, host, token] = match;
					hosts.set(host, { mode: 'token', token });
					continue;
				}

				// 6. Host-specific user/pass Auth: //host/:username=user
				// and //host/:password=pass
				// Note: This handles both user and password in the same line
				match = line.match(/^\/\/([^/]+)\/?:username=(.+)$/);
				if (match) {
					const [, host, user] = match;
					const passLine = lines.find(l => l.startsWith(`//${host}/:password=`));
					if (!passLine) continue;

					// Extract the password part even if it contains '=' characters
					const [, password] = passLine.split(/=(.+)/);
					hosts.set(host, { mode: 'user-pass', user, token: password });
				}
			}

			// Apply scopes
			for (const [scope, hostname] of scopes) {
				const base = hostname
					.replace(/^https?:\/\//, '')
					.replace(/^www\./, '')
					.replace(/\/+$/, '')
					.toLowerCase();
				const data: IProviderData = {
					origin,
					base,
					hostname,
					auth: { mode: 'none' }
				};
				if (hosts.has(hostname)) {
					const auth = hosts.get(hostname)!;
					data.auth = { ...auth };
				}
				this.#scopes.set(scope, data);
			}

			// Apply hosts
			for (const [host, auth] of hosts) {
				const base = `https://${host}/`;
				const data: IProviderData = { origin, base, hostname: host, auth: { ...auth } };
				this.#hosts.set(host, data);
			}
		}
	}
}
