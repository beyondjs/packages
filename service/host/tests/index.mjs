import { Deadline } from '../../deadline.mjs';
import { Hosts } from '../hosts.mjs';
import { Command } from '../launches/command.mjs';
import { Journal } from '../logs/journal.mjs';
import { Runs } from './runs.mjs';
import { TestsRoutes } from './routes.mjs';

/**
 * Test runs from the service (capability `tests`, version 1): the workspace's tests run as `beyond test` runs them, their
 * results kept and announced. See `docs/service.md#test-runs`.
 *
 * Enabled only where the service can run them as a launch runs a module: it was given the `launch` setting, whose
 * `node.register` is the BEE Node registration, it pairs browsers, and a process it starts can read it (a loopback
 * service without a public origin). A service that verifies delegated grants (`BEYOND_AUTHORITY`) mounts nothing.
 * Otherwise no route is mounted and no capability claimed.
 *
 * Every change of a run is announced as `tests.changed {run}` and its start and end are logged (`tests`).
 */
export class Feature {
	static NAME = 'tests';

	/**
	 * Milliseconds a run may take (`BEYOND_TESTS_TIMEOUT`)
	 */
	static TIMEOUT = new Deadline('BEYOND_TESTS_TIMEOUT', 600000);

	#context;
	#runs;
	#logged = new Set();

	/**
	 * @param {{root: string, settings: object, events?: {emit(type: string, data: object): void}, journal?: Journal,
	 * origins?: {api: () => string | undefined}, environment?: Record<string, string | undefined>}} context What the host
	 * gives every feature
	 */
	constructor(context) {
		this.#context = context;
	}

	/**
	 * Whether this service can run tests
	 */
	get enabled() {
		const { settings = {}, environment = process.env } = this.#context;
		if (environment.BEYOND_AUTHORITY || !settings.pairing || !Command.valid(settings.launch)) return false;
		return Hosts.loopback(settings.bind ?? '127.0.0.1') && !settings.pairing.public;
	}

	start() {
		if (!this.enabled) return;
		const { root, settings, events, journal = new Journal(), origins, environment = process.env } = this.#context;
		const changed = run => {
			const value = run.toJSON();
			events?.emit('tests.changed', { run: value });
			this.#log(journal, value);
		};
		this.#runs = new Runs({ root, register: settings.launch.node.register, origin: () => origins?.api?.(), environment, timeout: Feature.TIMEOUT.read(environment), changed });
	}

	#log(journal, { id, state, files, summary, reason }) {
		if (state === 'running') {
			if (this.#logged.has(id)) return;
			this.#logged.add(id);
			return journal.add('info', 'tests', `Tests started: ${files.length} file${files.length === 1 ? '' : 's'}`);
		}
		this.#logged.delete(id);
		const counted = `${summary.passed} passed, ${summary.failed} failed, ${summary.skipped} skipped`;
		const level = state === 'passed' ? 'info' : state === 'cancelled' ? 'warn' : 'error';
		journal.add(level, 'tests', `Tests ${state}: ${counted}${reason ? `. ${reason.message}` : ''}`);
	}

	/**
	 * @param {import('express').Application} app
	 */
	setup(app) {
		this.#runs && new TestsRoutes(this.#runs).setup(app);
	}

	get capabilities() {
		return this.#runs ? { tests: 1 } : {};
	}

	/**
	 * Cancels the run under way, as the service ends
	 */
	async stop() {
		await this.#runs?.end();
	}
}
