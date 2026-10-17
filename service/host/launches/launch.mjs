import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { Failure } from './failure.mjs';
import { Group } from './group.mjs';
import { Output } from './output.mjs';

/**
 * One launch of an execution target: its process, which leads a process group of its own, its state and its output.
 *
 * | State | Meaning |
 * | --- | --- |
 * | `starting` | The process is being created |
 * | `running` | The process lives; that is all that is known of it |
 * | `ready` | Its declared readiness text appeared in its output |
 * | `stopping` | It was asked to stop: `SIGTERM` to its group, `SIGKILL` once the bound of the stop passes |
 * | `exited` | It ended after a stop, or by itself with code 0 (once ready, when a readiness is declared) |
 * | `failed` | It could not be started, or it ended by itself otherwise; `reason` says how, with the end of its output, and `failure` why, in a person's words (`Failure`) |
 *
 * A process that lives is never said to be ready without its declared readiness (`readiness`: `observed`, `waiting`
 * or `undeclared`), and nothing here says that it serves.
 *
 * ```js
 * const launch = new Launch(target, { changed: launch => announce(launch), announce: launch => announce(launch) });
 * launch.start({ executable, args, cwd, env });
 * launch.stop(10000);
 * await launch.ended;
 * ```
 */
export class Launch {
	/**
	 * The lines of output a failure's reason carries
	 */
	static TAIL = 20;

	/**
	 * Milliseconds the end of the output is awaited once the process exited, so a failure carries its last words
	 */
	static SETTLE = 200;

	static #LIVE = ['starting', 'running', 'ready', 'stopping'];

	#id = `lch_${randomBytes(12).toString('hex')}`;
	#target;
	#state = 'starting';
	#process;
	#group;
	#started;
	#ready;
	#ended;
	#exit;
	#reason;
	#failure;
	#observed = false;
	#gone = false;
	#requested = false;
	#output;
	#changed;
	#clock;
	#timer;
	#finish;
	#diagnostics;
	#port;
	#ending = new Promise(resolve => (this.#finish = resolve));

	/**
	 * @param {{application: string, target: string, specifier: string, environment: string, readiness?: string}} target
	 * What is launched, and the text whose appearance in the output makes the process ready
	 * @param {{changed?: (launch: Launch) => void, announce?: (launch: Launch) => void, clock?: {now(): number},
	 * diagnostics?: {code: string, message: string}[], port?: number}} [options] Called when the state changes, and when
	 * lines arrived (at most four times a second); what the preparation of its command said (a variable it did not give);
	 * the port it is given to listen on, when it is known
	 */
	constructor(target, { changed = () => void 0, announce = () => void 0, clock = Date, diagnostics = [], port } = {}) {
		this.#target = target;
		this.#port = port;
		this.#changed = changed;
		this.#clock = clock;
		this.#diagnostics = diagnostics.map(diagnostic => ({ ...diagnostic }));
		this.#output = new Output({ announce: () => announce(this), observe: text => this.#watch(text), clock });
	}

	get id() {
		return this.#id;
	}

	get application() {
		return this.#target.application;
	}

	get target() {
		return this.#target.target;
	}

	/**
	 * The port it is given to listen on, undefined when it is not known
	 */
	get port() {
		return this.#port;
	}

	get state() {
		return this.#state;
	}

	get output() {
		return this.#output;
	}

	/**
	 * Whether its process may still run: it has not ended
	 */
	get live() {
		return Launch.#LIVE.includes(this.#state) && !this.#gone;
	}

	/**
	 * Settles once the launch reached its final state
	 *
	 * @returns {Promise<void>}
	 */
	get ended() {
		return this.#ending;
	}

	/**
	 * Whether its process group still holds a process this launch may signal: while it lives, or once a stop was asked
	 * (a group whose launch ended by itself is never signalled, see `kill`)
	 */
	get alive() {
		return (this.live || this.#requested) && !!this.#group?.alive;
	}

	/**
	 * Starts the process, in a process group of its own so that its descendants are stopped with it
	 *
	 * @param {{executable: string, args: string[], cwd: string, env: Record<string, string>}} command
	 */
	start({ executable, args, cwd, env }) {
		this.#started = this.#now();
		try {
			this.#process = spawn(executable, args, { cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
		} catch (error) {
			return this.#refused(error);
		}

		const child = this.#process;
		this.#group = child.pid ? new Group(child.pid) : void 0;
		child.once('spawn', () => this.#state === 'starting' && this.#set('running'));
		// Without an identifier the process never ran (an executable that is missing or not executable)
		child.once('error', error => !child.pid && !this.#gone && this.#refused(error));
		for (const stream of ['stdout', 'stderr']) {
			child[stream].setEncoding('utf8').on('data', chunk => this.#output.write(stream, chunk));
			child[stream].once('end', () => this.#output.end(stream));
		}
		const closed = new Promise(resolve => child.once('close', resolve));
		child.once('exit', (code, signal) => this.#exited(code, signal, closed));
		this.#changed(this);
	}

	/**
	 * Fails the launch before any process is started, as when the port it listens on is taken
	 *
	 * @param {{code: string, message: string}} failure
	 */
	refuse(failure) {
		this.#started = this.#now();
		this.#gone = true;
		this.#ended = this.#started;
		this.#failure = { ...failure };
		this.#reason = { code: 'LAUNCH_REFUSED', message: `Nothing was started: ${failure.message}` };
		this.#output.close();
		this.#set('failed');
		this.#finish();
	}

	/**
	 * Asks the process to stop: `SIGTERM` to its group now, `SIGKILL` to whatever of the group remains once the bound
	 * passed. Asking again while it stops changes nothing.
	 *
	 * @param {number} bound Milliseconds
	 * @returns {boolean} Whether the launch was live
	 */
	stop(bound) {
		if (!this.live) return false;
		if (this.#state === 'stopping') return true;
		this.#requested = true;
		this.#set('stopping');
		this.#group?.signal('SIGTERM');
		this.#timer = setTimeout(() => this.kill(), bound);
		this.#timer.unref?.();
		return true;
	}

	/**
	 * Ends the process group now with `SIGKILL`: what remains of a launch that was asked to stop, or a launch that lives
	 * when the service ends without time for a stop. A group whose launch ended by itself is not signalled.
	 */
	kill() {
		clearTimeout(this.#timer);
		if ((this.live || this.#requested) && this.#group?.alive) this.#group.signal('SIGKILL');
	}

	/**
	 * The record of the launch, as the routes answer it
	 */
	toJSON() {
		const { application, target, specifier, environment, readiness } = this.#target;
		return {
			id: this.#id,
			application,
			target,
			specifier,
			environment,
			state: this.#state,
			pid: this.#process?.pid ?? null,
			started: this.#started,
			...(this.#ready ? { ready: this.#ready } : {}),
			...(this.#ended ? { ended: this.#ended } : {}),
			...(this.#exit ? { exit: { ...this.#exit } } : {}),
			readiness: readiness ? (this.#observed ? 'observed' : 'waiting') : 'undeclared',
			...(this.#port ? { port: this.#port } : {}),
			...(this.#reason ? { reason: { ...this.#reason, ...(this.#reason.tail ? { tail: [...this.#reason.tail] } : {}) } } : {}),
			...(this.#failure ? { failure: { ...this.#failure } } : {}),
			...(this.#diagnostics.length ? { diagnostics: this.#diagnostics.map(diagnostic => ({ ...diagnostic })) } : {})
		};
	}

	#now() {
		return new Date(this.#clock.now()).toISOString();
	}

	#set(state) {
		this.#state = state;
		this.#changed(this);
	}

	/**
	 * Its declared readiness appears in its output, once. Output read after the process exited still counts as said,
	 * but makes no ended process ready
	 */
	#watch(text) {
		const { readiness } = this.#target;
		if (!readiness || this.#observed || !text.includes(readiness)) return;
		this.#observed = true;
		this.#ready = this.#now();
		!this.#gone && ['starting', 'running'].includes(this.#state) ? this.#set('ready') : this.#changed(this);
	}

	/**
	 * The process could not be created: it never ran
	 */
	#refused(error) {
		this.#gone = true;
		this.#ended = this.#now();
		this.#reason = { code: 'LAUNCH_SPAWN_FAILED', message: `The process could not be started: ${error?.message ?? error}` };
		this.#output.close();
		this.#set('failed');
		this.#finish();
	}

	/**
	 * The process ended. Whether it was asked to is decided now, from the state it was in; the end of its output, which
	 * may arrive after its exit, is awaited within a bound before the launch is said to have ended, so a readiness or
	 * an error written just before the end is read
	 */
	async #exited(code, signal, closed) {
		this.#gone = true;
		const requested = this.#state === 'stopping';
		const ended = this.#now();
		// A group that a stop emptied needs no SIGKILL; one where processes remain receives it at the bound
		requested && this.#group && !this.#group.alive && clearTimeout(this.#timer);

		const settle = new Promise(resolve => setTimeout(resolve, Launch.SETTLE).unref?.());
		await Promise.race([closed, settle]);
		this.#output.close();
		this.#exit = { code, signal };
		this.#ended = ended;
		const declared = !!this.#target.readiness;
		const expected = requested || (code === 0 && !signal && (!declared || this.#observed));
		if (!expected) {
			const how = signal ? `by the signal ${signal}` : `with code ${code}`;
			const when = declared && !this.#observed ? ', before its readiness was observed' : '';
			this.#reason = { code: 'LAUNCH_EXITED', message: `The process ended by itself ${how}${when}`, tail: this.#output.tail(Launch.TAIL) };
			this.#failure = Failure.of({ lines: this.#output.read(0).lines.map(({ text }) => text), code, signal });
		}
		this.#set(expected ? 'exited' : 'failed');
		this.#finish();
	}
}
