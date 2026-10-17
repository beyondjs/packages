import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Deno } from '../settings/deno.mjs';
import { Executable, Variables } from '../settings/values.mjs';
import { LaunchError } from './error.mjs';

/**
 * The command that runs a launchable target: the executable, its arguments, the directory, the environment, and what
 * the launch says of how it prepared them (`diagnostics`).
 *
 * - **Node** runs as the command line runs a module: `node --enable-source-maps --import <stacks> --import <register>
 *   <launcher> <specifier>`, the BEE Node registration and the command line's launcher that the `launch` setting names,
 *   with the loader configured for this service (`BEE_URL` its API origin, `BEE_ADAPTER=packages`, `BEE_IMPORT_MAP`
 *   empty). An uncaught error is printed source-mapped and without the toolchain's frames, a missing package as what to
 *   do about it (`Command.STACKS`, `service/stacks`), the registration's and the launcher's directories hidden too
 *   (`BEYOND_STACKS_HIDDEN`).
 * - **Deno** runs `deno run --allow-net --allow-import --allow-env` with the service's Node import map
 *   (`<origin>/importmap.json?target=node&format=esm`) over `deno.mjs` of this directory, which imports the specifier.
 *   It also passes `--no-config` and `--no-lock`, so no configuration or lock file of the workspace is read or written,
 *   and `--reload=<origin>/`, so a module the service rebuilt is never taken from the cache, which is
 *   `<root>/.beyond/launches/deno` (`DENO_DIR`, in the state directory that ignores itself for Git). The executable is
 *   the `launch` setting's `deno.executable`, else the `launch.deno` setting of the settings feature, else
 *   `BEYOND_DENO`, read at every launch and checked at every launch as the setting is when it is changed: an absolute
 *   path to an existing file the service may execute that answers `--version` as Deno 2 within its bound
 *   (`DENO_INVALID` otherwise).
 *
 * Both run in the workspace root with the environment of the service without its own credentials and settings (see
 * `Command.INTERNAL`), the bootstrap's loader configuration replaced, and the variables the settings feature keeps for
 * the target (`targets.<application>.<target>.environment`), which never replace the loader configuration: a reserved
 * name (`Variables.reserved`) the settings file holds is not given, and the launch says so (`LAUNCH_VARIABLE_IGNORED`).
 */
export class Command {
	/**
	 * Variables of the service that never reach a launched process: its settings, which carry its start token and
	 * local credential, its access configuration, and the bootstrap's loader configuration, which is replaced
	 */
	static INTERNAL = Object.freeze(['BEYOND_HOST_OPTIONS', 'BEYOND_SERVICE_OPTIONS', 'BEYOND_AUTHORITY', 'BEYOND_ENVIRONMENT', 'BEYOND_TRUST_LOOPBACK', 'BEE_URL', 'BEE_ADAPTER', 'BEE_IMPORT_MAP']);

	/**
	 * Any other variable of the Beyond namespace that names a secret
	 */
	static SECRET = /^BEYOND_(\w+_)?(TOKEN|SECRET|CREDENTIALS?|PASSWORD|KEY)(_\w+)?$/;

	/**
	 * The module a Deno launch runs, which imports the specifier it is given
	 */
	static ENTRY = fileURLToPath(new URL('./deno.mjs', import.meta.url));

	/**
	 * The module a Node launch imports first, which prints an uncaught error without the toolchain's frames
	 */
	static STACKS = new URL('../../stacks/register.mjs', import.meta.url).href;

	static #NAME = /^[A-Z_][A-Z0-9_]*$/;

	#setting;
	#root;
	#environment;
	#settings;
	#origin;
	#check;
	#readable;

	/**
	 * @param {{node: {register: string, launcher: string}, deno?: {executable?: string}}} setting The `launch` setting
	 * @param {{root: string, environment: Record<string, string | undefined>, settings?: () => ({value?: (key: string) =>
	 * unknown} | undefined), origin: () => string | undefined, executable?: {verify(path: string): Promise<{message?:
	 * string}>}, readable?: boolean}} context The workspace root, the environment of the service, how to reach the
	 * settings feature when there is one, the API origin of the service once it listens, what checks a Deno executable
	 * (the check of the `launch.deno` setting by default), and whether a launched process may read the service (not
	 * behind a public origin, on another address or behind grants that let no loopback request through)
	 */
	constructor(setting, { root, environment, settings = () => void 0, origin, executable, readable = true }) {
		this.#readable = readable;
		this.#setting = setting;
		this.#root = root;
		this.#environment = environment;
		this.#settings = settings;
		this.#origin = origin;
		this.#check = executable ?? new Executable(new Deno({ environment }));
	}

	/**
	 * Whether a `launch` setting names what Node launches with
	 *
	 * @param {unknown} setting
	 */
	static valid(setting) {
		const { register, launcher } = setting?.node ?? {};
		return [register, launcher].every(value => typeof value === 'string' && (value.startsWith('file:') || isAbsolute(value)));
	}

	/**
	 * @param {import('./target.mjs').Target} target
	 * @param {string} [reached] The origin the request to launch reached, which stands for the API origin when the host
	 * gives none
	 * @returns {Promise<{executable: string, args: string[], cwd: string, env: Record<string, string>, diagnostics:
	 * {code: string, message: string, name?: string}[]}>}
	 * @throws {LaunchError} `UNAVAILABLE` before the service listens; `TARGET_NOT_LAUNCHABLE` (`LAUNCH_CONSUMER_REFUSED`,
	 * `DENO_NOT_CONFIGURED`, `DENO_INVALID`)
	 */
	async of(target, reached) {
		if (!this.#readable) {
			const message = 'A launched process presents no credential, and this development service gives a process without one nothing to read (it is reached through a public origin, listens on another address or verifies delegated grants): nothing is launched';
			throw LaunchError.unlaunchable('LAUNCH_CONSUMER_REFUSED', message);
		}
		const origin = this.#origin() ?? reached;
		if (!origin) throw new LaunchError('UNAVAILABLE', 'The development service does not listen yet: launch again in a moment');
		const { variables, diagnostics } = await this.#variables(target);
		const environment = { ...this.#clean(), ...variables };
		const command = target.environment === 'deno' ? await this.#deno(target, origin, environment) : this.#node(target, origin, environment);
		return { ...command, diagnostics };
	}

	#node({ specifier }, origin, environment) {
		const { register, launcher } = this.#setting.node;
		const url = register.startsWith('file:') ? register : pathToFileURL(register).href;
		const script = launcher.startsWith('file:') ? fileURLToPath(launcher) : launcher;
		const path = url.startsWith('file:') ? fileURLToPath(url) : url;
		const hidden = JSON.stringify([dirname(path), dirname(script)]);
		const env = { ...environment, BEE_URL: origin, BEE_ADAPTER: 'packages', BEE_IMPORT_MAP: '', BEYOND_STACKS_HIDDEN: hidden };
		const args = ['--enable-source-maps', '--import', Command.STACKS, '--import', url, script, specifier];
		return { executable: process.execPath, args, cwd: this.#root, env };
	}

	async #deno({ specifier }, origin, environment) {
		const executable = await this.#executable();
		const directory = join(this.#root, '.beyond', 'launches', 'deno');
		await mkdir(directory, { recursive: true });
		// The state directory of the service ignores itself for Git, whichever feature created it first
		await writeFile(join(this.#root, '.beyond', '.gitignore'), '*\n', { flag: 'wx' }).catch(error => {
			if (error.code !== 'EEXIST') throw error;
		});
		const args = [
			'run',
			'--no-config',
			'--no-lock',
			'--allow-net',
			'--allow-import',
			'--allow-env',
			`--reload=${origin}/`,
			`--import-map=${origin}/importmap.json?target=node&format=esm`,
			Command.ENTRY,
			specifier
		];
		return { executable, args, cwd: this.#root, env: { ...environment, DENO_DIR: directory, NO_COLOR: '1' } };
	}

	/**
	 * The Deno executable, read and checked at every launch: the `launch` setting, the settings feature, the environment
	 */
	async #executable() {
		const configured = this.#setting.deno?.executable ?? (await this.#settings()?.value?.('launch.deno')) ?? this.#environment.BEYOND_DENO;
		if (typeof configured !== 'string' || !configured) {
			const message = 'Deno is not configured on this development service: set the "launch.deno" setting or BEYOND_DENO to a Deno 2 executable';
			throw LaunchError.unlaunchable('DENO_NOT_CONFIGURED', message);
		}
		const path = resolve(configured);
		const { message } = await this.#check.verify(path);
		if (message) throw LaunchError.unlaunchable('DENO_INVALID', `The Deno executable of this development service is refused: ${message}`);
		return path;
	}

	/**
	 * The variables the settings feature keeps for the target, those with a valid name and a text value; a reserved
	 * name is left out and said
	 */
	async #variables({ application, target }) {
		const kept = await this.#settings()?.value?.(`targets.${application}.${target}.environment`);
		if (!kept || typeof kept !== 'object' || Array.isArray(kept)) return { variables: {}, diagnostics: [] };
		const valid = Object.entries(kept).filter(([name, value]) => Command.#NAME.test(name) && typeof value === 'string');
		const diagnostics = valid
			.filter(([name]) => Variables.reserved(name))
			.map(([name]) => ({ code: 'LAUNCH_VARIABLE_IGNORED', name, message: `${name} of the target's variables was not given: it is reserved for the loader, the runtime or the toolchain` }));
		const variables = Object.fromEntries(valid.filter(([name]) => !Variables.reserved(name)));
		return { variables, diagnostics };
	}

	/**
	 * The environment of the service without what never reaches a launched process
	 */
	#clean() {
		const entries = Object.entries(this.#environment ?? {}).filter(([name, value]) => {
			if (value === undefined || Command.INTERNAL.includes(name)) return false;
			return !Command.SECRET.test(name);
		});
		return Object.fromEntries(entries);
	}
}
