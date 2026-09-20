import type { OriginType } from '@beyond-js/packages/providers/settings/types';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as os from 'os';
import { join } from 'path';
import * as fs from 'fs';

const execute = promisify(exec);

export interface ILocalFilesOptions {
	// Path of the user rc file; false disables it. Defaults to the rc file of the home directory
	user?: string | false;
	// Path of the global rc file; false disables it. When undefined it is asked to the package manager
	global?: string | false;
}

export interface ILocalFile {
	path: string;
	origin: OriginType;
	content: string;
}

/**
 * The rc files that apply to a package, ordered from the most specific (project) to the broadest (global).
 */
export class LocalSettingsFiles extends Array<ILocalFile> {
	#pkg: string;
	#workspace?: string;
	#options: ILocalFilesOptions;

	constructor(pkg: string, workspace?: string, options: ILocalFilesOptions = {}) {
		super();
		this.#pkg = pkg;
		this.#workspace = workspace;
		this.#options = options;
	}

	// Array methods that create arrays (map, filter) must produce plain arrays
	static get [Symbol.species]() {
		return Array;
	}

	/**
	 * Asks the package manager where its global configuration lives. The subprocess is awaited: its
	 * result used to be read from the unresolved promise, so the global file was never found.
	 */
	async #global(): Promise<string | undefined> {
		const { global } = this.#options;
		if (global === false) return;
		if (typeof global === 'string') return global;

		try {
			const { stdout } = await execute('npm config get globalconfig', { timeout: 10_000 });
			return stdout.toString().trim() || void 0;
		} catch {
			return;
		}
	}

	/**
	 * Finds the files that exist and reads their content
	 */
	async process(): Promise<void> {
		const tentative: { path: string; origin: OriginType }[] = [];
		tentative.push({ path: join(this.#pkg, '.npmrc'), origin: 'project-rc' });

		if (this.#workspace && this.#workspace !== this.#pkg) {
			tentative.push({ path: join(this.#workspace, '.npmrc'), origin: 'workspace-rc' });
		}

		const { user } = this.#options;
		if (user !== false) tentative.push({ path: user || join(os.homedir(), '.npmrc'), origin: 'user-rc' });

		const global = await this.#global();
		global && tentative.push({ path: global, origin: 'global-rc' });

		this.length = 0;
		const seen = new Set<string>();
		for (const { path, origin } of tentative) {
			// The first role of a file wins: a workspace that is also the home directory stays workspace
			if (seen.has(path)) continue;
			seen.add(path);

			let content: string;
			try {
				content = await fs.promises.readFile(path, 'utf8');
			} catch {
				continue;
			}
			this.push({ path, origin, content });
		}
	}
}
