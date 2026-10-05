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

	/**
	 * How long a running service that lacks an extension the caller needs, and that ends by itself once nobody
	 * is attached (`lifetime: 'attachments'`), is given to stop accepting connections before it is taken as in use
	 * and refused, in milliseconds: the idle time of its host (2 s) and a grace. It is how the service of a command
	 * that just ended is replaced instead of reported as in use.
	 */
	static SETTLE = 5000;

	/**
	 * How long the whole departure of such a service is waited for before another one is started in its place, in
	 * milliseconds: its idle time (2 s), the end of its host (6 s at most), the stop of what its preparation started
	 * (4 s at most) and its last sweep. The new service is started only once the previous supervisor exited or
	 * removed its record, so the two never prepare the same service directory at once.
	 */
	static DEPART = 15000;

	/**
	 * The supervisor a start launches, a script run by Node
	 */
	static SUPERVISOR = fileURLToPath(new URL('./supervisor/main.mjs', import.meta.url));

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
	 * @throws {ServiceError} `SERVICE_EXTENSIONS_MISSING` when the running service lacks an extension this call
	 * names and is held by its owner, still in use after `Service.SETTLE`, or still ending after `Service.DEPART`:
	 * it is not reused as if it had the extension, and it is not replaced while it is there
	 * @throws {ContractError} `UNAVAILABLE` when the running service answers that it cannot describe itself now
	 */
	async acquire({ lifetime, port, bind, extensions = Service.extensions(process.env) }) {
		// Whoever waits for the lock waits for as long as the holder's start can last, stop and description
		// included, and the time the holder gives a service that lacks an extension to leave, its last look
		// included, so that a slow start is not reported to it as a failed one
		const env = process.env;
		const timeout = Service.#deadline.read(env) + Startup.GRACE + Service.DEPART + Discovery.PROBE + 3 * Connection.deadline(env);

		return this.#discovery.exclusive(async () => {
			const found = await this.find();
			const reused = found && (await this.#reusable(found, extensions));
			if (reused) return { connection: reused, started: false };

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
	 * The running service, when it has every extension the caller names. The extensions describe a service when
	 * it starts, so one started without an extension never gains it. A service that ends by itself once nobody is
	 * attached, such as the one a command that just finished started, is given `Service.SETTLE` to stop accepting
	 * connections and `Service.DEPART` for its supervisor to end, and a service with the extensions is then
	 * started under the same lock. One its owner holds, one still in use and one still ending are not replaced:
	 * the caller is told which extensions are missing and how to have them, instead of receiving a service whose
	 * routes it expects and does not find.
	 *
	 * @param {Connection} connection
	 * @param {string[]} [requested]
	 * @returns {Promise<Connection | undefined>} undefined when the service ended and another one is to be started
	 */
	async #reusable(connection, requested = []) {
		const loaded = connection.session.service.extensions ?? [];
		const missing = requested.filter(specifier => !loaded.includes(specifier));
		if (!missing.length) return connection;

		// A record gone since it was found is a service that is ending
		const record = this.#discovery.read();
		const leaving = record ?? { origin: connection.origin, pid: connection.session.service.pid, lifetime: 'attachments' };
		const bounds = { settle: Service.SETTLE, deadline: Service.DEPART };
		const departure = leaving.lifetime === 'attachments' ? await this.#discovery.departure(leaving, bounds) : 'held';
		if (departure === 'ended') return;

		const names = missing.join(', ');
		const where = `The development service of "${connection.session.workspace.root}" (${connection.origin})`;
		const ending = `${where} stopped answering and is still ending: its supervisor (pid ${leaving.pid}) did not end within ${Service.DEPART}ms`;
		const message = departure === 'ending'
			? `${ending}. Run this command again once it ended: it then starts the service with ${names}, which this command needs`
			: `${where} is in use without ${names}, which this command needs, and a running service is reused as it was started. ` +
				`End the commands and applications that use it, so that it stops, and run this command again: it then starts the service with ${names}`;
		throw new ServiceError(message, record?.log, 'SERVICE_EXTENSIONS_MISSING');
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

		const child = spawn(process.execPath, [Service.SUPERVISOR], {
			detached: true,
			stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
			env: { ...process.env, NODE_OPTIONS: '', BEYOND_SERVICE_OPTIONS: JSON.stringify(options) }
		});

		return new Startup(child, { deadline, log }).outcome();
	}
}
