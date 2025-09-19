import { IProviderAuth } from '@beyond-js/packages/providers/types';

export class AuthHeaders {
	static token = (auth: IProviderAuth) => ({ Authorization: `Bearer ${auth.token}` });
	static basic = (auth: IProviderAuth) => ({ Authorization: `Basic ${auth.token}` });
	static userpass = (auth: IProviderAuth) => ({
		Authorization: `Basic ${Buffer.from(`${auth.user}:${auth.token}`).toString('base64')}`
	});

	static process(auth: IProviderAuth): Record<string, string> {
		switch (auth.mode) {
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
