import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Connection } from './connection.mjs';
import { Discovery } from './discovery.mjs';
import { Home } from './home.mjs';
import { Installation } from './installation.mjs';

const SUPERVISOR = fileURLToPath(new URL('./supervisor/main.mjs', import.meta.url));

/**
 * A service that could not be started, with where its output was logged
 */
export class ServiceError extends Error {
	constructor(message, log) {
		super(message);
		this.name = 'ServiceError';
		this.code = 'SERVICE_START_FAILED';
		this.log = log;
	}
}

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
	 * them describe a service this call starts and are ignored when a running service is reused.
	 * @returns {Promise<{connection: Connection, started: boolean, token?: string}>}
	 */
	acquire({ lifetime, port, bind, extensions }) {
		return this.#discovery.exclusive(async () => {
			const found = await this.find();
			if (found) return { connection: found, started: false };

			const token = randomUUID();
			const record = await this.#start({ lifetime, port, bind, extensions, token });
			const connection = await Connection.validate(record, this.#expected, this.#headers);
			if (!connection) throw new ServiceError('The service started but did not describe itself as expected', record.log);
			return { connection, started: true, token };
		});
	}

	/**
	 * Starts the supervisor detached from this process and waits for the outcome of the start
	 */
	#start({ lifetime, port, bind, extensions, token }) {
		const { root, standalone } = this.#context;
		const options = { root, standalone, lifetime, port, bind, extensions, token, home: this.#home.path };

		const child = spawn(process.execPath, [SUPERVISOR], {
			detached: true,
			stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
			env: { ...process.env, NODE_OPTIONS: '', BEYOND_SERVICE_OPTIONS: JSON.stringify(options) }
		});

		return new Promise((resolve, reject) => {
			const settle = outcome => {
				child.removeAllListeners();
				child.connected && child.disconnect();
				child.unref();
				outcome();
			};

			child.on('message', ({ ready, failed, log }) =>
				settle(() => (ready ? resolve(ready) : reject(new ServiceError(failed, log))))
			);
			child.once('error', error => settle(() => reject(new ServiceError(error.message))));
			child.once('exit', code => settle(() => reject(new ServiceError(`The service supervisor exited (${code})`))));
		});
	}
}
