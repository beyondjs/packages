import { promises as fs } from 'fs';
import { join } from 'path';
import * as os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';

import { Registries } from '../registries';
import { Rules } from '../rules';
import { Auth } from '../auth';
import type { TOrigin } from '../types';

const processCmd = promisify(exec);

/**
 * Load registry and scope configurations from local .npmrc files.
 */
export class LocalLoader {
	readonly #registries: Registries;

	constructor(registries: Registries) {
		this.#registries = registries;
	}

	async load(pkg: string, workspace?: string): Promise<void> {
		const files: { path: string; origin: TOrigin }[] = [];

		files.push({ path: join(pkg, '.npmrc'), origin: 'project-rc' });
		if (workspace && workspace !== pkg) {
			files.push({ path: join(workspace, '.npmrc'), origin: 'workspace-rc' });
		}
		files.push({ path: join(os.homedir(), '.npmrc'), origin: 'user-rc' });

		try {
			const { stdout } = await processCmd('npm config get globalconfig');
			files.push({ path: stdout.trim(), origin: 'global-rc' });
		} catch {}

		for (const { path, origin } of files) {
			let content: string;
			try {
				content = await fs.readFile(path, 'utf8');
			} catch {
				continue;
			}

			const lines = content.split('\n').map(line => line.trim());

			for (const line of lines) {
				if (!line || line.startsWith('#') || line.startsWith(';')) continue;

				let match: RegExpMatchArray | null;

				// Scope to registry mapping
				match = line.match(/^(@[^:]+):registry=(.+)$/);
				if (match) {
					const [, scope, url] = match;
					const host = url.replace(/^https?:\/\//, '').replace(/\/+$/, '');
					this.#registries.addScope(scope, host);
					continue;
				}

				// Token auth
				match = line.match(/^\/\/([^/]+)\/?:_authToken=(.+)$/);
				if (match) {
					const [, host, token] = match;
					this.#registries.add(host, {
						auth: new Auth('token', token),
						origin
					});
					continue;
				}

				// Basic auth
				match = line.match(/^_auth=(.+)$/);
				if (match) {
					const token = match[1];
					this.#registries.add('registry.npmjs.org', {
						auth: new Auth('basic', token),
						origin
					});
					continue;
				}

				// User/pass auth
				match = line.match(/^\/\/([^/]+)\/?:username=(.+)$/);
				if (match) {
					const [, host, user] = match;
					const passLine = lines.find(line => line.startsWith(`//${host}/:password=`));
					if (passLine) {
						const pass = passLine.split('=')[1];
						this.#registries.add(host, {
							auth: new Auth('user-pass', pass, user),
							origin
						});
					}
				}
			}
		}
	}
}
