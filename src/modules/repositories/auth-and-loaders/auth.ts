import type { RegistryAuthType, IRegistryAuth } from './types';

/**
 * Handles registry authentication logic, including HTTP headers generation.
 *
 * Example:
 * ```ts
 * const auth = new Auth('token', 'abc123');
 * console.log(auth.headers); // { authorization: 'Bearer abc123' }
 * ```
 */
export class Auth implements IRegistryAuth {
	#type: RegistryAuthType;
	#token: string;
	#user?: string;

	constructor(type: RegistryAuthType, token: string, user?: string) {
		this.#type = type;
		this.#token = token;
		this.#user = user;
	}

	/**
	 * Returns the authentication type ('token' | 'basic' | 'user-pass').
	 */
	get type(): RegistryAuthType {
		return this.#type;
	}

	/**
	 * Returns the authentication token or base64 string.
	 */
	get token(): string {
		return this.#token;
	}

	/**
	 * Returns the username, if using 'user-pass' authentication.
	 */
	get user(): string | undefined {
		return this.#user;
	}

	/**
	 * Returns the HTTP headers to be used for authenticated requests.
	 */
	get headers(): Record<string, string> {
		switch (this.#type) {
			case 'token':
				return { authorization: `Bearer ${this.#token}` };

			case 'basic':
				return { authorization: `Basic ${this.#token}` };

			case 'user-pass': {
				if (!this.#user) throw new Error('User is required for user-pass authentication');
				const encoded = Buffer.from(`${this.#user}:${this.#token}`).toString('base64');
				return { authorization: `Basic ${encoded}` };
			}
		}
	}
}
