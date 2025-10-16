import { IProviderAuthData } from '@beyond-js/packages/providers/settings/types';

export class AuthHeaders {
	static token = (auth: IProviderAuthData) => ({ Authorization: `Bearer ${auth.token}` });
	static basic = (auth: IProviderAuthData) => ({ Authorization: `Basic ${auth.token}` });
	static userpass = (auth: IProviderAuthData) => ({
		Authorization: `Basic ${Buffer.from(`${auth.user}:${auth.token}`).toString('base64')}`
	});

	static process(auth: IProviderAuthData): Record<string, string> {
		switch (auth.mode) {
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
}
