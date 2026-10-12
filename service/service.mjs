import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Connection } from './connection.mjs';
import { Credential } from './credential.mjs';
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
	 * The access context presented to the service of a record: the caller's, or the local credential of a service
	 * that pairs browsers, which the record names and only this user can read
	 */
	#access(record) {
		if (Object.keys(this.#headers).some(name => name.toLowerCase() === 'authorization')) return this.#headers;
		const authorization = Credential.authorization(record?.credential);
		return authorization ? { ...this.#headers, authorization } : this.#headers;
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

		const connection = await Connection.validate(record, this.#expected, this.#access(record));
		if (connection) return connection;

		// The process of the record exists but is not this service: the record is stale, the process is not ours
		this.#discovery.remove(record.pid);
	}

	/**
	 * @param {{lifetime: 'owner' | 'attachments', port?: number, bind?: string, extensions?: string[], pairing?: true |
	 * {origins?: string[], public?: string}, interface?: string, launch?: object, exclusive?: boolean}} options How a
	 * service started by this call ends; an
	 * explicit port; the address it listens on, which is the loopback one unless something else controls who reaches
	 * the service, because the service has no authentication; the module specifiers of the extensions that add routes to
	 * its host; whether it pairs browsers (`beyond-dev-pairing/1`), with the interface origins allowed besides its own
	 * and the public origin of an external server (`{port}` standing for its port); and the directory of the interface
	 * build it serves at `/ui/` when it pairs. All of them describe a service this call starts and are ignored when a
	 * running service is reused. A caller that names no extensions starts the ones of `BEYOND_SERVICE_EXTENSIONS`
	 * (specifiers separated by commas), which is how a person adds the development extension, and with it the preview
	 * of the workspace, to the service that a command starts. `launch` enables the launch of execution targets in a
	 * service this call starts (`{node: {register, launcher}}`, see the launches feature of the host), which only the
	 * command line's `beyond run` gives. `exclusive` starts a service of its own that no other caller finds or reuses,
	 * and that reuses none, as a headless build needs: it never attaches to a person's running service.
	 * @returns {Promise<{connection: Connection, started: boolean, token?: string}>}
	 * @throws {ServiceError} `SERVICE_EXTENSIONS_MISSING` when the running service lacks an extension this call
	 * names, and `SERVICE_PAIRING_MISSING` when it does not pair browsers and this call asks for pairing, and it is held
	 * by its owner, still in use after `Service.SETTLE`, or still ending after `Service.DEPART`: it is not reused as if
	 * it had them, and it is not replaced while it is there
	 * @throws {ContractError} `UNAVAILABLE` when the running service answers that it cannot describe itself now
	 */
	async acquire({ lifetime, port, bind, extensions = Service.extensions(process.env), pairing, interface: build, launch, exclusive = false }) {
		if (exclusive) return this.#exclusive({ lifetime, port, bind, extensions, pairing, interface: build, launch });

		// Whoever waits for the lock waits for as long as the holder's start can last, stop and description
		// included, and the time the holder gives a service that lacks an extension to leave, its last look
		// included, so that a slow start is not reported to it as a failed one
		const env = process.env;
		const timeout = Service.#deadline.read(env) + Startup.GRACE + Service.DEPART + Discovery.PROBE + 3 * Connection.deadline(env);

		return this.#discovery.exclusive(async () => {
			const found = await this.find();
			const reused = found && (await this.#reusable(found, extensions, !!pairing, !!launch));
			if (reused) return { connection: reused, started: false };

			const token = randomUUID();
			const record = await this.#start({ lifetime, port, bind, extensions, token, pairing, interface: build, launch });
			const connection = await this.#described(record);
			return { connection, started: true, token };
		}, { timeout });
	}

	/**
	 * Starts a service of its own, under a discovery record keyed also by an identifier of this start, so it neither
	 * reuses a running service nor is found by another caller; it ends with its lifetime like any other
	 */
	async #exclusive({ lifetime, port, bind, extensions, pairing, interface: build, launch }) {
		const token = randomUUID();
		const exclusive = randomUUID();
		const record = await this.#start({ lifetime, port, bind, extensions, token, pairing, interface: build, launch, exclusive });
		const connection = await this.#described(record);
		return { connection, started: true, token };
	}

	/**
	 * The description of a service this call started, with its log when it cannot be had. A service that
	 * answers too late is reported as such, because a slow answer and a wrong one are different failures:
	 * the first is deployment configuration, the second means the port belongs to something else.
	 */
	async #described(record) {
		let connection;
		try {
			connection = await Connection.validate(record, this.#expected, this.#access(record));
		} catch (error) {
			if (error?.code !== 'SERVICE_NOT_ANSWERING') throw error;
			throw new ServiceError(error.message, record.log, error.code);
		}

		if (!connection) throw new ServiceError('The service started but did not describe itself as expected', record.log);
		return connection;
	}

	/**
	 * The running service, when it has every extension the caller names and pairs browsers when the caller asks for
	 * pairing. Both describe a service when it starts, so one started without them never gains them. A service that
	 * ends by itself once nobody is attached, such as the one a command that just finished started, is given
	 * `Service.SETTLE` to stop accepting connections and `Service.DEPART` for its supervisor to end, and a service with
	 * them is then started under the same lock. One its owner holds, one still in use and one still ending are not
	 * replaced: the caller is told what is missing and how to have it, instead of receiving a service whose routes it
	 * expects and does not find.
	 *
	 * @param {Connection} connection
	 * @param {string[]} [requested]
	 * @param {boolean} [pairing] Whether the caller needs a service that pairs browsers
	 * @param {boolean} [launch] Whether the caller needs a service that launches execution targets
	 * @returns {Promise<Connection | undefined>} undefined when the service ended and another one is to be started
	 */
	async #reusable(connection, requested = [], pairing = false, launch = false) {
		const loaded = connection.session.service.extensions ?? [];
		const missing = requested.filter(specifier => !loaded.includes(specifier));
		const capabilities = connection.session.toJSON().capabilities ?? {};
		const unpaired = pairing && !capabilities.pairing;
		const unlaunched = launch && !capabilities.launch;
		if (!missing.length && !unpaired && !unlaunched) return connection;

		// A record gone since it was found is a service that is ending
		const record = this.#discovery.read();
		const leaving = record ?? { origin: connection.origin, pid: connection.session.service.pid, lifetime: 'attachments' };
		const bounds = { settle: Service.SETTLE, deadline: Service.DEPART };
		const departure = leaving.lifetime === 'attachments' ? await this.#discovery.departure(leaving, bounds) : 'held';
		if (departure === 'ended') return;

		const names = [...missing, ...(unpaired ? ['pairing'] : []), ...(unlaunched ? ['the launch of execution targets'] : [])].join(', ');
		const where = `The development service of "${connection.session.workspace.root}" (${connection.origin})`;
		const ending = `${where} stopped answering and is still ending: its supervisor (pid ${leaving.pid}) did not end within ${Service.DEPART}ms`;
		const message = departure === 'ending'
			? `${ending}. Run this command again once it ended: it then starts the service with ${names}, which this command needs`
			: `${where} is in use without ${names}, which this command needs, and a running service is reused as it was started. ` +
				`End the commands and applications that use it, so that it stops, and run this command again: it then starts the service with ${names}`;
		const code = missing.length ? 'SERVICE_EXTENSIONS_MISSING' : unpaired ? 'SERVICE_PAIRING_MISSING' : 'SERVICE_LAUNCH_MISSING';
		throw new ServiceError(message, record?.log, code);
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
	#start({ lifetime, port, bind, extensions, token, pairing, interface: build, launch, exclusive }) {
		const deadline = Service.#deadline.read(process.env);
		const { root, standalone } = this.#context;
		const options = { root, standalone, lifetime, port, bind, extensions, token, home: this.#home.path, pairing, interface: build, ...(launch ? { launch } : {}), ...(exclusive ? { exclusive } : {}) };

		// Where the supervisor logs, which it names itself once it can: a start that fails before, or never
		// ends, is reported with it as well. An exclusive service keeps its own directory
		const key = exclusive ? new Discovery(this.#home, { root, toolchain: this.#installation.id, exclusive }).key : this.#discovery.key;
		const log = join(this.#home.directory('services', key), 'service.log');

		const child = spawn(process.execPath, [Service.SUPERVISOR], {
			detached: true,
			stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
			env: { ...process.env, NODE_OPTIONS: '', BEYOND_SERVICE_OPTIONS: JSON.stringify(options) }
		});

		return new Startup(child, { deadline, log }).outcome();
	}
}
