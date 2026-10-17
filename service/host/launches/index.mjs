import { Deadline } from '../../deadline.mjs';
import { Hosts } from '../hosts.mjs';
import { Command } from './command.mjs';
import { Launches } from './launches.mjs';
import { LaunchRoutes } from './routes.mjs';

/**
 * The launch of execution targets from the service (`beyond-launches/1`): a declared backend target started as the
 * command line runs a module, through the BEE Node registration and the launcher of the installation, or in Deno when
 * an executable is configured. See `docs/launches.md` and the suite's `docs/products/packages/developer-journey.md`.
 *
 * Opt-in: it is enabled only on a service started with the `launch` setting (`{node: {register, launcher}, deno?:
 * {executable}}`, absolute paths or file URLs), which the command line's `beyond run` gives. A service started without
 * it (`beyond test`, `beyond install`, an embedded compiler, any import of Packages) mounts no route, claims no `launch`
 * capability and can start no process. Launching needs a service that decides who reaches it: one that pairs browsers
 * or verifies delegated grants (`BEYOND_AUTHORITY`); any other refuses to start with the setting, so no page of another
 * site, and no local consumer, can start a process through a service that does not tell them apart.
 *
 * Launches end with the service: `stop()` closes the registry, so a request decided afterwards launches nothing
 * (`UNAVAILABLE`), sends `SIGTERM` to every live launch and `SIGKILL` to what remains within the bound the host's own end
 * allows. A process exit that leaves no time for it sends `SIGKILL` at once: that handler stays registered until every
 * process the feature may signal has ended, or until the host exits.
 */
export class Feature {
	static NAME = 'launches';

	/**
	 * Milliseconds a stop waits before `SIGKILL` (`BEYOND_LAUNCH_STOP`)
	 */
	static STOP = 10000;

	/**
	 * Milliseconds the service's end waits for its launches before `SIGKILL`, within the host's own bound on its end
	 */
	static ENDING = 2500;

	/**
	 * Milliseconds the resolution of a target may take beyond the bound of a workspace reload, which it may wait for
	 */
	static MARGIN = 5000;

	static #deadline = new Deadline('BEYOND_LAUNCH_STOP', Feature.STOP);
	static #reload = new Deadline('BEYOND_WORKSPACE_TIMEOUT', 120000);

	#context;
	#launches;
	#bound;
	#exit;

	/**
	 * @param {{root: string, settings: object, events?: object, services: {get(name: string): any}, origins?: {api: () =>
	 * string | undefined}, environment?: Record<string, string | undefined>, log?: Function}} context What the host gives
	 * every feature
	 */
	constructor(context) {
		this.#context = context;
	}

	/**
	 * Whether this service launches execution targets
	 */
	get enabled() {
		return this.#context.settings?.launch !== undefined && this.#context.settings?.launch !== null;
	}

	/**
	 * Checks the setting and prepares the registry; a setting that cannot be used fails the start of the service
	 *
	 * @throws {Error} For a `launch` setting without the Node registration and launcher, or a service that neither pairs
	 * browsers nor verifies delegated grants
	 */
	async start() {
		if (!this.enabled) return;
		const { root, settings, events, services, origins, environment = process.env } = this.#context;
		if (!Command.valid(settings.launch)) throw new Error('The launch setting names the BEE Node registration and the launcher by absolute path: {node: {register, launcher}}');
		if (!settings.pairing && !environment.BEYOND_AUTHORITY) {
			throw new Error('A service that launches execution targets decides who reaches it: it pairs browsers (the pairing setting) or verifies delegated grants (BEYOND_AUTHORITY), and this one does neither');
		}

		this.#bound = Feature.#deadline.read(environment);
		const resolution = Feature.#reload.read(environment) + Feature.MARGIN;
		// The services are read at each launch: the development extension registers its own once it is mounted
		const readable = Feature.#readable(settings, environment);
		const command = new Command(settings.launch, { root, environment, readable, settings: () => services?.get('settings'), origin: () => origins?.api?.() });
		const configured = () => services?.get('settings');
		this.#launches = new Launches({ catalog: () => services?.get('applications'), command, events, bound: this.#bound, resolution, settings: configured });

		// A process that exits without time for a stop leaves no launch behind
		this.#exit = () => this.#launches.kill();
		process.once('exit', this.#exit);
	}

	/**
	 * Whether a launched process, which presents no credential and no grant, may read the modules it runs from this
	 * service: a local consumer of a loopback service that pairs without a public origin (behind a public origin or on
	 * another address nobody is a local consumer), or, where delegated grants decide (`BEYOND_AUTHORITY`), a loopback
	 * process when they let loopback requests through (`BEYOND_TRUST_LOOPBACK=1`)
	 */
	static #readable(settings, environment) {
		if (settings.pairing) return Hosts.loopback(settings.bind ?? '127.0.0.1') && !settings.pairing.public;
		return environment.BEYOND_TRUST_LOOPBACK === '1';
	}

	/**
	 * Mounts the routes, only on a service that launches
	 *
	 * @param {import('express').Application} app
	 */
	setup(app) {
		this.#launches && new LaunchRoutes(this.#launches).setup(app);
	}

	/**
	 * `launch: 1` on a service that launches, nothing otherwise
	 *
	 * @returns {Record<string, number>}
	 */
	get capabilities() {
		return this.#launches ? { launch: 1 } : {};
	}

	/**
	 * Ends every live launch, as the service ends. The handler that kills at the exit of the host stays while a process
	 * the feature may signal remains, and is released once every such launch has ended
	 */
	async stop() {
		if (!this.#launches) return;
		const launches = this.#launches;
		await launches.end({ grace: Math.min(this.#bound, Feature.ENDING) });
		const release = () => launches.alive || process.off('exit', this.#exit);
		launches.alive ? void launches.settled().then(release) : release();
	}
}
