import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Where the toolchain keeps what is not part of any project: the discovery records of running services,
 * their logs and the staged implementation projects. `BEYOND_HOME` relocates it, which is how tests and
 * isolated environments keep their services apart from the ones of the user.
 */
export class Home {
	#path;
	get path() {
		return this.#path;
	}

	constructor(path = process.env.BEYOND_HOME) {
		this.#path = path || Home.#default();
	}

	static #default() {
		const { platform, env } = process;
		if (platform === 'darwin') return join(homedir(), 'Library', 'Application Support', 'beyond');
		if (platform === 'win32') return join(env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'beyond');
		return join(env.XDG_STATE_HOME || join(homedir(), '.local', 'state'), 'beyond');
	}

	/**
	 * A directory of this home, created on demand
	 */
	directory(...segments) {
		const path = join(this.#path, ...segments);
		mkdirSync(path, { recursive: true });
		return path;
	}
}
