import type { IProviderAuthData } from '@beyond-js/packages/providers/settings/types';
import type { ILocalFilesOptions } from './files';
import { LocalSettingsFiles } from './files';
import { TokenTools } from './tools';
import { Layer } from '../../layer';

/**
 * Reads registry, scope and credential declarations from the rc files that apply to a package.
 * Each file becomes its own layer, so a broader file can never overwrite a more specific one.
 */
export class LocalLoader {
	#layers: Layer[] = [];
	/**
	 * One layer per file found, from the most specific (project) to the broadest (global)
	 */
	get layers() {
		return this.#layers;
	}

	#env: Record<string, string | undefined>;
	#options: ILocalFilesOptions;

	constructor(options: ILocalFilesOptions = {}, env: Record<string, string | undefined> = {}) {
		this.#options = options;
		this.#env = env;
	}

	async load(pkg: string, workspace?: string): Promise<void> {
		const files = new LocalSettingsFiles(pkg, workspace, this.#options);
		await files.process();

		this.#layers = files.map(({ content, origin }) => this.#parse(new Layer(origin), content));
	}

	#parse(layer: Layer, content: string): Layer {
		const users: Map<string, string> = new Map();
		const passwords: Map<string, string> = new Map();

		for (const raw of content.split('\n')) {
			const line = raw.trim();
			if (!line || line.startsWith('#') || line.startsWith(';')) continue;

			const index = line.indexOf('=');
			if (index === -1) continue;
			const key = line.slice(0, index).trim();
			const value = TokenTools.clean(line.slice(index + 1), this.#env);
			if (!value) continue;

			// Credentials of a host: //host[:port][/path]/:_authToken=…
			const hosted = /^(\/\/.+?)\/?:(_authToken|_auth|username|_password|password)$/.exec(key);
			if (hosted) {
				const [, host, field] = hosted;
				if (field === '_authToken') layer.host(host, { mode: 'token', token: value });
				else if (field === '_auth') layer.host(host, { mode: 'basic', token: value });
				else if (field === 'username') users.set(host, value);
				else passwords.set(host, field === '_password' ? this.#decode(value) : value);
				continue;
			}

			// Scope to registry mapping: @scope:registry=https://host/
			const scoped = /^(@[^:]+):registry$/.exec(key);
			if (scoped) {
				layer.scope(scoped[1], value);
				continue;
			}

			if (key === 'registry') layer.default(value);
			else if (key === '_authToken') layer.credentials({ mode: 'token', token: value });
			else if (key === '_auth') layer.credentials({ mode: 'basic', token: value });
			else if (key === 'username') users.set('', value);
			else if (key === '_password') passwords.set('', this.#decode(value));
			else if (key === 'password') passwords.set('', value);
		}

		// A user is a credential only together with its password, whatever the order of the lines
		for (const [host, user] of users) {
			if (!passwords.has(host)) continue;
			const auth: IProviderAuthData = { mode: 'user-pass', user, token: passwords.get(host) };
			host ? layer.host(host, auth) : layer.credentials(auth);
		}

		return layer;
	}

	#decode(value: string): string {
		return Buffer.from(value, 'base64').toString('utf8');
	}
}
