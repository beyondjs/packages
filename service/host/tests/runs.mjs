import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Command } from '../launches/command.mjs';
import { Collection } from './collection.mjs';
import { TestsError } from './error.mjs';
import { Run } from './run.mjs';

/**
 * The test runs of one service: one at a time, the last `Runs.RETAINED` kept in memory, each run as `beyond test` runs
 * the tests (Node's test runner, the BEE Node registration against this service, `BEE_IDENTITY`, source maps), with
 * the reporter of this directory.
 *
 * ```js
 * const runs = new Runs({ root, register, origin: () => origin, environment: process.env, timeout, changed });
 * const run = runs.create(['web/home/view.test.ts']);
 * runs.cancel(run.id);
 * ```
 */
export class Runs {
	static RETAINED = 10;
	static REPORTER = new URL('./reporter.mjs', import.meta.url).href;

	/**
	 * Variables of a test runner that runs the service itself: a run of the service's own is never a child of it
	 */
	static #RUNNER = Object.freeze(['NODE_TEST_CONTEXT']);

	#root;
	#register;
	#origin;
	#environment;
	#timeout;
	#changed;
	#runs = new Map();
	#closed = false;

	/**
	 * @param {{root: string, register: string, origin: () => string | undefined, environment: Record<string, string |
	 * undefined>, timeout: number, changed?: (run: Run) => void}} specs The root, the BEE Node registration (a path or
	 * a file URL), the API origin once the service listens, the environment of the service, the bound of a run and what
	 * is told of every change
	 */
	constructor({ root, register, origin, environment, timeout, changed = () => void 0 }) {
		this.#root = root;
		this.#register = register.startsWith('file:') ? register : pathToFileURL(register).href;
		this.#origin = origin;
		this.#environment = environment;
		this.#timeout = timeout;
		this.#changed = changed;
	}

	/**
	 * The runs kept, the newest first
	 */
	list() {
		return [...this.#runs.values()].reverse().map(run => run.toJSON());
	}

	/**
	 * @param {string} id
	 * @throws {TestsError} `TESTS_RUN_NOT_FOUND`
	 */
	get(id) {
		const run = this.#runs.get(id);
		if (!run) throw new TestsError('TESTS_RUN_NOT_FOUND', `This development service has no test run "${id}"`);
		return run;
	}

	/**
	 * Starts a run over the files named, or every test file of the workspace
	 *
	 * @param {unknown} [files]
	 * @returns {Run}
	 * @throws {TestsError} `UNAVAILABLE`, `TESTS_RUNNING`, `TESTS_FILES_INVALID`, `TESTS_NOT_FOUND`
	 */
	create(files) {
		if (this.#closed) throw new TestsError('UNAVAILABLE', 'The development service is ending: no test runs');
		const running = [...this.#runs.values()].find(run => run.running);
		if (running) throw new TestsError('TESTS_RUNNING', 'Tests are already running: wait for them, or cancel them', { run: running.toJSON() });
		const origin = this.#origin();
		if (!origin) throw new TestsError('UNAVAILABLE', 'The development service does not listen yet: run the tests again in a moment');
		const collection = new Collection(this.#root, files);
		if (!collection.files.length) throw new TestsError('TESTS_NOT_FOUND', 'No test file was found (a test file is named <name>.test.ts, .mts, .js or .mjs)');

		const run = new Run({ root: this.#root, files: collection.names, changed: run => this.#changed(run) });
		this.#runs.set(run.id, run);
		this.#prune();
		run.start(this.#command(origin, collection.files), { timeout: this.#timeout });
		return run;
	}

	/**
	 * @param {string} id
	 * @throws {TestsError} `TESTS_RUN_NOT_FOUND`, `TESTS_RUN_ENDED`
	 */
	cancel(id) {
		const run = this.get(id);
		if (!run.cancel()) throw new TestsError('TESTS_RUN_ENDED', `The test run "${id}" already ended (${run.state})`, { run: run.toJSON() });
		return run;
	}

	/**
	 * Cancels what runs and accepts no new run, as the service ends
	 */
	async end(bound = Run.GRACE + 1000) {
		this.#closed = true;
		const running = [...this.#runs.values()].filter(run => run.running);
		running.forEach(run => run.cancel({ code: 'TESTS_CANCELLED', message: 'The development service ended' }));
		let timer;
		await Promise.race([Promise.all(running.map(run => run.ended)), new Promise(resolve => (timer = setTimeout(resolve, bound)))]);
		clearTimeout(timer);
	}

	/**
	 * The runner's command, as `beyond test` gives it, with this directory's reporter
	 */
	#command(origin, files) {
		const args = [
			'--import', this.#register,
			'--enable-source-maps',
			'--experimental-test-module-mocks',
			'--disable-warning=ExperimentalWarning',
			'--test',
			`--test-reporter=${Runs.REPORTER}`,
			'--test-reporter-destination=stdout',
			...files
		];
		const clean = Object.entries(this.#environment ?? {}).filter(([name, value]) => value !== undefined && !Command.INTERNAL.includes(name) && !Command.SECRET.test(name) && !Runs.#RUNNER.includes(name));
		const env = { ...Object.fromEntries(clean), BEE_URL: origin, BEE_ADAPTER: 'packages', BEE_IMPORT_MAP: '', BEE_IDENTITY: join(this.#root, '.beyond', 'modules') };
		return { executable: process.execPath, args, cwd: this.#root, env };
	}

	#prune() {
		const ended = [...this.#runs.values()].filter(run => !run.running);
		ended.slice(0, Math.max(0, this.#runs.size - Runs.RETAINED)).forEach(run => this.#runs.delete(run.id));
	}
}
