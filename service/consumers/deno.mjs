import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * How a Deno process consumes the modules of a development service: it runs a module file of its own, which imports
 * public specifiers, and Deno resolves them through the service's import map of the artifacts built for Node, which
 * Deno consumes. The service's launches of Deno targets (`host/launches/command.mjs`) and the command line's
 * `beyond run --target` of one start Deno this way, so both run a target alike.
 *
 * - `--allow-net`, `--allow-import` and `--allow-env`: the process reads the service and its environment, and nothing
 *   else is granted.
 * - `--no-config` and `--no-lock`: no configuration or lock file of the workspace is read or written.
 * - `--reload=<origin>`: a module the service rebuilt is never taken from Deno's cache, which is `directory(root)`
 *   (`DENO_DIR`, in the state directory of the workspace, which ignores itself for Git). The origin is given without a
 *   trailing slash: Deno 2 matches `<origin>/` against no module of the origin, and took every one from its cache.
 * - `--quiet`: Deno's own diagnostic lines (each module it downloads) are not written among the program's output;
 *   its errors still are.
 *
 * ```js
 * const args = DenoConsumer.arguments({ origin, entry: '/path/to/launcher.mjs', args: ['app/server'] });
 * const env = { ...process.env, DENO_DIR: await DenoConsumer.prepare(root) };
 * spawn(deno, args, { env });
 * ```
 */
export class DenoConsumer {
	/**
	 * The arguments of `deno` that run a module file as a consumer of the service at an origin
	 *
	 * @param {{origin: string, entry: string, args?: string[]}} options The API origin of the service, the module file
	 * Deno runs, and the arguments that module receives
	 * @returns {string[]}
	 */
	static arguments({ origin, entry, args = [] }) {
		return [
			'run',
			'--no-config',
			'--no-lock',
			'--allow-net',
			'--allow-import',
			'--allow-env',
			'--quiet',
			`--reload=${origin.replace(/\/+$/, '')}`,
			`--import-map=${origin}/importmap.json?target=node&format=esm`,
			entry,
			...args
		];
	}

	/**
	 * Deno's cache for the consumers of a workspace
	 *
	 * @param {string} root The root of the workspace
	 */
	static directory(root) {
		return join(root, '.beyond', 'launches', 'deno');
	}

	/**
	 * Creates the cache directory, and the ignore file of the state directory when no feature created it first
	 *
	 * @param {string} root The root of the workspace
	 * @returns {Promise<string>} The cache directory, for `DENO_DIR`
	 */
	static async prepare(root) {
		const directory = DenoConsumer.directory(root);
		await mkdir(directory, { recursive: true });
		await writeFile(join(root, '.beyond', '.gitignore'), '*\n', { flag: 'wx' }).catch(error => {
			if (error.code !== 'EEXIST') throw error;
		});
		return directory;
	}
}
