import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Connection } from './connection.mjs';
import { Deadline } from './deadline.mjs';
import { Discovery } from './discovery.mjs';
import { ServiceError } from './errors.mjs';
import { Home } from './home.mjs';
import { Installation } from './installation.mjs';
import { Startup } from './startup.mjs';

export { ServiceError };

const SUPERVISOR = fileURLToPath(new URL('./supervisor/main.mjs', import.meta.url));

/**
 * The development service of one workspace, as a command uses it: reuse the one that runs, or start it.
 *
 * ```js
 * const service = new Service(context);
 * const { connection, started, token } = await service.acquire({ lifetime: 'owner' });
 * ```
 *
 * Commands of different terminals that name the same workspace with the same toolchain share one service.
 * Looking for it and starting it happen under a lock, so simultaneous commands start one; whoever waited
 * for the lock finds the service of whoever held it.
 */
export class Service {
	/**
	 * The default deadline of a start, in milliseconds (`BEYOND_START_TIMEOUT`). It covers the whole start on
	 * a loaded host: the preparation of the bootstrap (90 s at most), the watchers child
	 * (`BEYOND_WATCHERS_TIMEOUT`) and the first read of the workspace (`BEYOND_WORKSPACE_TIMEOUT`, 120 s),
	 * each of which reports its own failure first. A deployment that raises those raises this one too.
	 */
	static START = 300000;

	static #deadline = new Deadline('BEYOND_START_TIMEOUT', Service.START);

	#context;
	#installation = new Installation();
	#home;
	#discovery;
	#headers;

	/**
	 * The installed Packages this client starts services with
	 */
	get installation() {
		return this.#installation;
	}

	/**
	 * @param {import('./context.mjs').Context} context
	 * @param {{home?: string, headers?: Record<string, string>}} [options] Where records are kept, and the
	 * access context this client presents to a service whose host guards its routes
	 */
	constructor(context, { home, headers = {} } = {}) {
		this.#context = context;
		this.#headers = headers;
		this.#home = new Home(home);
		this.#discovery = new Discovery(this.#home, { root: context.root, toolchain: this.#installation.id });
	}

	get #expected() {
		return { root: this.#context.root, toolchain: this.#installation.id };
	}

	/**
	 * The running compatible service, if there is one. A record that no longer leads to it is discarded.
	 *
	 * A service that is there and answers too late is not discarded: the `TimeoutError` of the validation
	 * reaches the caller, so that a loaded host is told its service is slow instead of losing it.
	 */
	async find() {
		const record = this.#discovery.read();
		if (!record) return;

		const connection = await Connection.validate(record, this.#expected, this.#headers);
		if (connection) return connection;

		// The process of the record exists but is not this service: the record is stale, the process is not ours
		this.#discovery.remove(record.pid);
	}

	/**
	 * @param {{lifetime: 'owner' | 'attachments', port?: number, bind?: string, extensions?: string[]}}
	 * options How a service started by this call ends; an explicit port; the address it listens on, which
	 * is the loopback one unless something else controls who reaches the service, because the service has
	 * no authentication; and the module specifiers of the extensions that add routes to its host. All of
	 * them describe a service this call starts and are ignored when a running service is reused. A caller
	 * that names no extensions starts the ones of `BEYOND_SERVICE_EXTENSIONS` (specifiers separated by
	 * commas), which is how a person adds the development extension, and with it the preview of the
	 * workspace, to the service that a command starts.
	 * @returns {Promise<{connection: Connection, started: boolean, token?: string}>}
	 */
	async acquire({ lifetime, port, bind, extensions = Service.extensions(process.env) }) {
		// Whoever waits for the lock waits for as long as the holder's start can last, stop and description
		// included, so that a slow start is not reported to it as a failed one
		const env = process.env;
		const timeout = Service.#deadline.read(env) + Startup.GRACE + 2 * Connection.deadline(env);

		return this.#discovery.exclusive(async () => {
			const found = await this.find();
			if (found) return { connection: found, started: false };

			const token = randomUUID();
			const record = await this.#start({ lifetime, port, bind, extensions, token });
			const connection = await this.#described(record);
			return { connection, started: true, token };
		}, { timeout });
	}

	/**
	 * The description of a service this call started, with its log when it cannot be had. A service that
	 * answers too late is reported as such, because a slow answer and a wrong one are different failures:
	 * the first is deployment configuration, the second means the port belongs to something else.
	 */
	async #described(record) {
		let connection;
		try {
			connection = await Connection.validate(record, this.#expected, this.#headers);
		} catch (error) {
			if (error?.code !== 'SERVICE_NOT_ANSWERING') throw error;
			throw new ServiceError(error.message, record.log, error.code);
		}

		if (!connection) throw new ServiceError('The service started but did not describe itself as expected', record.log);
		return connection;
	}

	/**
	 * The extensions the environment names, undefined when it names none
	 *
	 * @param {Record<string, string | undefined>} environment
	 * @returns {string[] | undefined}
	 */
	static extensions(environment) {
		const names = (environment.BEYOND_SERVICE_EXTENSIONS ?? '').split(',').map(name => name.trim()).filter(name => name);
		return names.length ? names : void 0;
	}

	/**
	 * Starts the supervisor detached from this process and waits for the outcome of the start, within the
	 * deadline of `BEYOND_START_TIMEOUT`. A supervisor that is not ready by then is stopped.
	 */
	#start({ lifetime, port, bind, extensions, token }) {
		const deadline = Service.#deadline.read(process.env);
		const { root, standalone } = this.#context;
		const options = { root, standalone, lifetime, port, bind, extensions, token, home: this.#home.path };

		// Where the supervisor logs, which it names itself once it can: a start that fails before, or never
		// ends, is reported with it as well
		const log = join(this.#home.directory('services', this.#discovery.key), 'service.log');

		const child = spawn(process.execPath, [SUPERVISOR], {
			detached: true,
			stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
			env: { ...process.env, NODE_OPTIONS: '', BEYOND_SERVICE_OPTIONS: JSON.stringify(options) }
		});

		return new Startup(child, { deadline, log }).outcome();
	}
}
