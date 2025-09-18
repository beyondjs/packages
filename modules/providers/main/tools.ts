import { IRepositoryAuth } from '@beyond-js/packages/repositories/types';

export class AuthHeaders {
	static token = (auth: IRepositoryAuth) => ({ Authorization: `Bearer ${auth.token}` });
	static basic = (auth: IRepositoryAuth) => ({ Authorization: `Basic ${auth.token}` });
	static userpass = (auth: IRepositoryAuth) => ({
		Authorization: `Basic ${Buffer.from(`${auth.user}:${auth.token}`).toString('base64')}`
	});

	static process(auth: IRepositoryAuth): Record<string, string> {
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
