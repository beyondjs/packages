import type { IProviderAuthData, IProviderData } from '@beyond-js/packages/providers/settings/types';
import { Endpoint } from '@beyond-js/packages/providers/settings';

/**
 * The request that downloads an archive, or why there is none
 */
export interface ITarballRequest {
	url?: string;
	headers?: Record<string, string>;
	error?: { code: string; message: string };
}

export class AuthHeaders {
	static token = (auth: IProviderAuthData) => ({ Authorization: `Bearer ${auth.token}` });
	static basic = (auth: IProviderAuthData) => ({ Authorization: `Basic ${auth.token}` });
	static userpass = (auth: IProviderAuthData) => ({
		Authorization: `Basic ${Buffer.from(`${auth.user}:${auth.token}`).toString('base64')}`
	});

	static process(auth: IProviderAuthData): Record<string, string> {
		switch (auth?.mode) {
			case void 0:
			case 'none':
				return {};
			case 'token':
				return this.token(auth);
			case 'basic':
				return this.basic(auth);
			case 'user-pass':
				if (!auth.user) throw new Error('User is required for user-pass authentication');
				return this.userpass(auth);
			default:
				throw new Error(`Unsupported authentication mode: ${auth.mode}`);
		}
	}

	/**
	 * Headers for a URL that the provider published (an archive, for example). Credentials are attached
	 * only when the URL belongs to the provider: they never follow a URL to another host, port or prefix.
	 */
	static within(provider: IProviderData, url: string): Record<string, string> {
		return new Endpoint(provider.base).contains(url) ? this.process(provider.auth) : {};
	}
}
