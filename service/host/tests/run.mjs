import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { isAbsolute, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Group } from '../launches/group.mjs';

/**
 * One run of Node's test runner over the workspace's test files: its process, which leads a process group of its own,
 * the results its reporter writes (see `reporter.mjs`) and its state.
 *
 * | State | Meaning |
 * | --- | --- |
 * | `running` | The runner runs |
 * | `passed` | It ended with code 0 and no test failed |
 * | `failed` | A test failed, or the runner ended otherwise (`reason` with the end of what it wrote) |
 * | `cancelled` | It was cancelled, or ran past its bound (`reason.code: TESTS_TIMEOUT`) |
 * | `unavailable` | The runner could not be started |
 *
 * ```js
 * const run = new Run({ root, files: collection.names, changed: run => announce(run) });
 * run.start({ executable, args, cwd, env }, { timeout: 600000 });
 * run.cancel();
 * await run.ended;
 * ```
 */
export class Run {
	/**
	 * The lines of the runner's error output a failure without results carries
	 */
	static TAIL = 30;

	/**
	 * Milliseconds between `SIGTERM` and `SIGKILL` when a run is cancelled
	 */
	static GRACE = 2000;

	/**
	 * Milliseconds between two announcements of the results that arrived while it runs
	 */
	static CADENCE = 1000;

	#id = `tst_${randomBytes(12).toString('hex')}`;
	#root;
	#files;
	#changed;
	#clock;
	#state = 'running';
	#started;
	#ended;
	#results = [];
	#reason;
	#group;
	#cancelled;
	#timers = [];
	#pending = '';
	#errors = [];
	#progress;
	#finish;
	#ending = new Promise(resolve => (this.#finish = resolve));

	/**
	 * @param {{root: string, files: string[], changed?: (run: Run) => void, clock?: () => number}} specs The root, the
	 * files relative to it, what is told of every change and the time
	 */
	constructor({ root, files, changed = () => void 0, clock = Date.now }) {
		this.#root = root;
		this.#files = files;
		this.#changed = changed;
		this.#clock = clock;
		this.#started = this.#clock();
	}

	get id() {
		return this.#id;
	}

	get state() {
		return this.#state;
	}

	get running() {
		return this.#state === 'running';
	}

	/**
	 * Settles once the run reached its final state
	 */
	get ended() {
		return this.#ending;
	}

	/**
	 * @param {{executable: string, args: string[], cwd: string, env: Record<string, string>}} command
	 * @param {{timeout: number}} bounds Milliseconds the run may take before it is cancelled
	 */
	start({ executable, args, cwd, env }, { timeout }) {
		let child;
		try {
			child = spawn(executable, args, { cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
		} catch (error) {
			return this.#end('unavailable', { code: 'TESTS_UNAVAILABLE', message: `The test runner could not be started: ${error.message}` });
		}
		this.#group = child.pid ? new Group(child.pid) : void 0;
		child.once('error', error => !child.pid && this.#end('unavailable', { code: 'TESTS_UNAVAILABLE', message: `The test runner could not be started: ${error.message}` }));
		child.stdout.setEncoding('utf8').on('data', chunk => this.#read(chunk));
		child.stderr.setEncoding('utf8').on('data', chunk => (this.#errors = [...this.#errors, ...chunk.split('\n').filter(Boolean)].slice(-Run.TAIL)));
		const closed = new Promise(resolve => child.once('close', resolve));
		child.once('exit', (code, signal) => void closed.then(() => this.#exited(code, signal)));
		const timer = setTimeout(() => this.cancel({ code: 'TESTS_TIMEOUT', message: `The tests ran for longer than ${timeout} ms and were stopped` }), timeout);
		timer.unref?.();
		this.#timers.push(timer);
		this.#changed(this);
	}

	/**
	 * Ends the run: `SIGTERM` to its group, `SIGKILL` to what remains after `Run.GRACE`
	 *
	 * @param {{code: string, message: string}} [reason]
	 * @returns {boolean} Whether it was running
	 */
	cancel(reason = { code: 'TESTS_CANCELLED', message: 'The run was cancelled' }) {
		if (!this.running || this.#cancelled) return false;
		this.#cancelled = reason;
		this.#group?.signal('SIGTERM');
		const timer = setTimeout(() => this.#group?.alive && this.#group.signal('SIGKILL'), Run.GRACE);
		timer.unref?.();
		this.#timers.push(timer);
		return true;
	}

	#read(chunk) {
		const lines = `${this.#pending}${chunk}`.split('\n');
		this.#pending = lines.pop();
		for (const line of lines) {
			if (!line.startsWith('{')) continue;
			try {
				const result = JSON.parse(line);
				result?.type === 'result' && this.#results.push(this.#result(result));
			} catch {
				// Not one of the reporter's lines
			}
		}
		if (!lines.length || this.#progress) return;
		this.#progress = setTimeout(() => {
			this.#progress = void 0;
			this.running && this.#changed(this);
		}, Run.CADENCE);
		this.#progress.unref?.();
	}

	#result({ file, name, line, column, state, duration, error }) {
		const own = this.#relative(file);
		const location = error ? (this.#locate(error.stack) ?? (own && line ? { file: own, line, column } : void 0)) : void 0;
		const failure = error ? { error: { message: String(error.message ?? ''), ...(location ? { location } : {}) } } : {};
		return { file: own ?? String(file ?? ''), name: String(name ?? ''), state, duration: Number(duration) || 0, ...failure };
	}

	/**
	 * A file inside the root, relative to it with forward slashes; undefined for anything else
	 */
	#relative(file) {
		if (typeof file !== 'string' || !file) return;
		const path = file.startsWith('file:') ? fileURLToPath(file) : file;
		const inside = relative(this.#root, path);
		if (!inside || inside.startsWith('..') || isAbsolute(inside)) return;
		return inside.split(sep).join('/');
	}

	/**
	 * The first frame of a stack in a source of the workspace: not an installed package, not the service's state
	 */
	#locate(stack) {
		for (const frame of String(stack ?? '').split('\n')) {
			const found = /((?:file:\/\/)?(?:\/|[A-Za-z]:\\)[^():\s]+):(\d+):(\d+)\)?\s*$/.exec(frame);
			const file = found && this.#relative(found[1]);
			if (!file || /(^|\/)(node_modules|\.beyond)\//.test(file)) continue;
			return { file, line: Number(found[2]), column: Number(found[3]) };
		}
	}

	#exited(code, signal) {
		if (this.#cancelled) return this.#end('cancelled', this.#cancelled);
		const failed = this.#results.some(({ state }) => state === 'failed');
		if (code === 0 && !failed) return this.#end('passed');
		const how = signal ? `was ended by the signal ${signal}` : `ended with code ${code}`;
		const reason = failed ? void 0 : { code: 'TESTS_EXITED', message: `The test runner ${how} before any test failed`, tail: [...this.#errors] };
		this.#end('failed', reason);
	}

	#end(state, reason) {
		if (!this.running) return;
		this.#timers.forEach(timer => clearTimeout(timer));
		clearTimeout(this.#progress);
		this.#state = state;
		this.#ended = this.#clock();
		this.#reason = reason;
		this.#changed(this);
		this.#finish();
	}

	toJSON() {
		const count = state => this.#results.filter(result => result.state === state).length;
		const ended = this.#ended !== undefined;
		const summary = {
			tests: this.#results.length,
			passed: count('passed'),
			failed: count('failed'),
			skipped: count('skipped') + count('todo'),
			duration: (this.#ended ?? this.#clock()) - this.#started
		};
		return {
			id: this.#id,
			state: this.#state,
			started: new Date(this.#started).toISOString(),
			...(ended ? { ended: new Date(this.#ended).toISOString() } : {}),
			files: [...this.#files],
			summary,
			results: this.#results.map(result => structuredClone(result)),
			...(this.#reason ? { reason: structuredClone(this.#reason) } : {})
		};
	}
}
