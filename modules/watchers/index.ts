import type { ChildProcess } from 'child_process';
import { spawn } from 'child_process';
import { ipc } from '@beyond-js/ipc/main';
import { PendingPromise } from '@beyond-js/pending-promise/main';

/**
 * The public module that implements the watchers service handlers in the child process
 */
const SPECIFIER = '@beyond-js/watchers/service/process';

export /*bundle*/ interface IWatchersServiceOptions {
	/**
	 * The Node arguments of the child process, which carry the module loader registration.
	 * It defaults to the arguments of the current process, so the child resolves and loads public modules
	 * exactly like its parent.
	 */
	execArgv?: string[];

	/**
	 * Environment values added to the ones of the current process, such as the endpoint from which the
	 * loader of the child obtains the compiled service
	 */
	env?: Record<string, string>;

	/**
	 * The working directory of the child process, from which its installed dependencies resolve.
	 * It defaults to the working directory of the current process.
	 */
	cwd?: string;

	/**
	 * The public module the child imports, which defaults to the watchers service process
	 */
	specifier?: string;

	/**
	 * Milliseconds to wait for the child to report that its handlers are installed
	 */
	timeout?: number;
}

/**
 * The filesystem watchers service that the packages of a workspace observe their sources with.
 *
 * Watching runs in a child Node process so that filesystem events never block compilation. The child is
 * started with the module loader of the current process, which lets it import the service implementation
 * as an ordinary public module, and it is registered under a name in the IPC router of this process:
 * that name is what watcher clients (`new WatcherClient(name, spec)`, created by each package) connect to.
 *
 * ```ts
 * const service = new WatchersService('watchers');
 * await service.start();
 * const workspace = new Workspace(path, { watcher: true });
 * // ...
 * await service.stop();
 * ```
 *
 * Startup is awaited: `start()` resolves once the child has installed its handlers, and rejects when the
 * child fails, exits or stays silent, so a broken watching setup is observable instead of silently
 * degrading into a workspace that never rebuilds. `stop()` unregisters the service and waits for the child
 * to exit.
 */
export /*bundle*/ class WatchersService {
	/**
	 * The name under which the service is registered, used by the watcher clients to address it
	 */
	#name: string;
	get name() {
		return this.#name;
	}

	#options: IWatchersServiceOptions;

	#process: ChildProcess;

	/**
	 * The process identifier of the child while the service is running
	 */
	get pid() {
		return this.#process?.pid;
	}

	#started = false;
	get started() {
		return this.#started;
	}

	/**
	 * Resolves with the exit code of the child, which lets stop() await its termination
	 */
	#stopped: PendingPromise<number | null>;

	constructor(name = 'watchers', options: IWatchersServiceOptions = {}) {
		this.#name = name;
		this.#options = options;
	}

	/**
	 * Starts the child process and registers it once it reports readiness
	 *
	 * @throws When the service is already started, or when the child fails to install its handlers
	 */
	async start(): Promise<void> {
		if (this.#process) throw new Error(`Watchers service "${this.#name}" is already started`);

		const options = this.#options;
		const specifier = options.specifier ?? SPECIFIER;
		const timeout = options.timeout ?? 15000;

		/**
		 * The child evaluates an ES module that imports the service implementation and then reports the
		 * outcome. Importing the public module is the whole startup: the service installs its handlers as
		 * an effect of being loaded.
		 */
		const entry =
			`import(${JSON.stringify(specifier)})` +
			`.then(() => process.send({ type: 'watchers:ready' }))` +
			`.catch(error => { process.send({ type: 'watchers:error', message: error.stack ?? String(error) }); process.exit(1); });`;

		const argv = [...(options.execArgv ?? process.execArgv), '--input-type=module', '-e', entry];
		const child = spawn(process.execPath, argv, {
			cwd: options.cwd ?? process.cwd(),
			env: Object.assign({}, process.env, options.env),
			// The fourth descriptor is the IPC channel used by the readiness protocol and by the service
			stdio: ['ignore', 'inherit', 'inherit', 'ipc']
		});

		this.#process = child;
		this.#stopped = new PendingPromise();
		child.once('exit', code => this.#stopped.resolve(code));

		await this.#ready(child, timeout);

		// Clients can only address the service once its handlers are installed
		ipc.register(this.#name, child);
		this.#started = true;
	}

	/**
	 * Waits for the readiness message of the child, rejecting on failure, early exit or timeout.
	 * A child that did not become ready is terminated and forgotten, so start() can be called again.
	 */
	async #ready(child: ChildProcess, timeout: number): Promise<void> {
		const ready = new PendingPromise<void>();

		const timer = setTimeout(() => {
			ready.reject(new Error(`Watchers service "${this.#name}" did not report readiness in ${timeout} ms.`));
		}, timeout);

		const onMessage = (message: { type?: string; message?: string }) => {
			if (typeof message !== 'object' || !message) return;
			if (message.type === 'watchers:ready') ready.resolve();
			if (message.type === 'watchers:error') {
				ready.reject(new Error(`Watchers service "${this.#name}" failed to start: ${message.message}`));
			}
		};
		const onExit = (code: number | null, signal: string | null) => {
			ready.reject(
				new Error(`Watchers service "${this.#name}" exited before ready (code ${code}, signal ${signal})`)
			);
		};
		const onError = (error: Error) => ready.reject(error);

		child.on('message', onMessage);
		child.once('exit', onExit);
		child.once('error', onError);

		try {
			await ready;
		} catch (error) {
			child.kill();
			this.#process = void 0;
			throw error;
		} finally {
			clearTimeout(timer);
			child.off('message', onMessage);
			child.off('exit', onExit);
			child.off('error', onError);
		}
	}

	/**
	 * Unregisters the service and terminates its child process.
	 *
	 * It resolves once the child has exited, and does nothing when the service was never started, so it is
	 * safe in a cleanup path that does not know how far startup progressed.
	 */
	async stop(): Promise<void> {
		const child = this.#process;
		if (!child) return;

		this.#started && ipc.unregister(this.#name);
		this.#started = false;
		this.#process = void 0;

		if (child.exitCode === null && !child.signalCode) child.kill();
		await this.#stopped;
	}
}
