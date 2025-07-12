// sources/ci.ts

import { Resolver } from '../index';
import { Registries } from '../registries';
import type { Registry } from '../types';

/**
 * Loads registry and scope configurations from environment variables (CI context).
 */
export class CiLoader extends Resolver {
	async process(): Promise<void> {
		this.#known();
		this.#custom();
	}

	#known(): void {
		for (const rule of Registries.known) {
			const { host, env, auth, source } = rule;

			const token = process.env[env.token];
			if (token) {
				this.registries.set(host, {
					source,
					host,
					auth: auth.token(token),
					origin: 'ci'
				});
				continue;
			}

			const user = process.env[env.user];
			const pass = process.env[env.pass];

			if (user && pass) {
				this.registries.set(host, {
					source,
					host,
					auth: auth.user(user, pass),
					origin: 'ci'
				});
			}
		}
	}

	#custom(): void {
		const raw = process.env.CI_REGISTRIES;
		if (!raw) return;

		const hosts = raw
			.split(',')
			.map(h => h.trim())
			.filter(Boolean);

		for (const host of hosts) {
			const key = host.toUpperCase().replace(/[^A-Z0-9]/g, '_');

			const token = process.env[`CI_TOKEN_${key}`];
			if (token) {
				this.registries.set(host, {
					source: 'custom',
					host,
					auth: Registries.custom.auth.token(token),
					origin: 'ci'
				});
				continue;
			}

			const user = process.env[`CI_USER_${key}`];
			const pass = process.env[`CI_PASS_${key}`];

			if (user && pass) {
				this.registries.set(host, {
					source: 'custom',
					host,
					auth: Registries.custom.auth.user(user, pass),
					origin: 'ci'
				});
			}
		}
	}
}
