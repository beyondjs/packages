import type { OriginType } from '@beyond-js/packages/providers/types';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as os from 'os';
import { join } from 'path';
import * as fs from 'fs';

const execute = promisify(exec);

export class LocalSettingsFiles extends Map<string, { path: string; origin: OriginType; content?: string }> {
	// Tentative files that may not exist yet
	#tentative: Map<string, { origin: OriginType }> = new Map();

	constructor(pkg: string, workspace?: string) {
		super();
		let path: string;

		// Set the default .npmrc file for the package
		path = join(pkg, '.npmrc');
		this.#tentative.set(path, { origin: 'project-rc' });

		// If a workspace is provided, add its .npmrc file
		if (workspace && workspace !== pkg) {
			path = join(workspace, '.npmrc');
			this.#tentative.set(path, { origin: 'workspace-rc' });
		}

		// Add the user .npmrc file
		path = join(os.homedir(), '.npmrc');
		this.#tentative.set(path, { origin: 'user-rc' });

		// Add the global npm config file if it exists
		try {
			path = execute('npm config get globalconfig').toString().trim();
			path && this.#tentative.set(path, { origin: 'global-rc' });
		} catch {}
	}

	/**
	 * Processes the local settings files, checking if they exist and reading their content.
	 */
	async process(): Promise<void> {
		for (const [path, { origin }] of this.#tentative) {
			// Check if the file exists
			try {
				await fs.promises.access(path);
			} catch {
				continue;
			}

			let content: string;
			try {
				content = await fs.promises.readFile(path, 'utf8');
			} catch {
				continue;
			}

			this.set(path, { path, origin, content });
		}
	}
}
