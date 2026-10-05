import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Composition } from './composition.mjs';
import { Holds } from './holds.mjs';
import { Turns } from './turns.mjs';

/**
 * The installation of the hosted workspace, through its service (the routes are `InstallationRoutes`).
 *
 * - `describe()` is the installation as it is on disk now: the state of the projection of the installed graph for
 *   what the workspace declares now (`ready`, `missing`, `stale`, `incomplete`, `incompatible`) with its
 *   diagnostics, the declaration, the lock and the projection, and whether an installation runs and how many wait.
 * - `install(options)` reads the declaration again and installs the workspace: an invalid declaration is refused
 *   with `422 DECLARATION_INVALID` and its diagnostics, and installs nothing. Installations of one service run one
 *   at a time, in the order they were asked for, each reading the declaration when its turn comes; one that does
 *   not get its turn within the queue bound is answered `503 UNAVAILABLE` and never runs, so its outcome is known.
 *   When the installation wrote the projection, the hosted workspace is reloaded before the answer, so an answer
 *   means that the service serves the installed graph. The answer is the report of the installation, valid or not:
 *   a failed installation is an outcome, not an error of the service. An installation holds the service while it
 *   runs (`Holds`), within its own deadline: a client that stops waiting for it, such as a command the user
 *   interrupted, does not end the service under it.
 *
 * The Packages classes are given by whoever creates it, so that this object only decides when they run.
 */
export class Installer {
	/**
	 * How long a request waits for the installations before it to end, in milliseconds
	 * (`BEYOND_INSTALL_QUEUE_TIMEOUT` names it for the service)
	 */
	static QUEUE = 120000;

	/**
	 * How long one installation may take, in milliseconds (`BEYOND_INSTALL_DEADLINE` names it for the service): the
	 * installation answers `INSTALLATION_TIMEOUT` past it, and holds the service as long
	 */
	static DEADLINE = 540000;

	/**
	 * What an installation that started writing may still take after its deadline, which no longer interrupts it,
	 * in milliseconds: the time it holds the service beyond the deadline
	 */
	static GRACE = 30000;

	#root;
	#hosted;
	#modules;
	#log;
	#queue;
	#deadline;
	#holds;
	#turns = new Turns();

	/**
	 * @param {{root: string, hosted: {reload: () => Promise<void>}, modules: {Declaration: object, Execution:
	 * object, installation: () => Promise<Function>}, log?: (message: string) => void, queue?: number, deadline?:
	 * number, holds?: Holds}} options The canonical root, the hosted workspace, the classes that read the declaration
	 * and the projection, the loader of the class that installs, which is loaded the first time it is needed, the
	 * queue bound and the deadline of one installation in milliseconds, and what keeps the service alive while an
	 * installation runs
	 */
	constructor({ root, hosted, modules, log = () => void 0, queue = Installer.QUEUE, deadline = Installer.DEADLINE, holds = new Holds() }) {
		this.#root = root;
		this.#hosted = hosted;
		this.#modules = modules;
		this.#log = log;
		this.#queue = queue;
		this.#deadline = deadline;
		this.#holds = holds;
	}

	/**
	 * The installation as it is on disk now, and whether one runs
	 */
	async describe() {
		const { Declaration, Execution } = this.#modules;
		const declaration = Declaration.read(this.#root);
		const { state, diagnostics, execution } = await Execution.read(this.#root, Composition.current(declaration));

		return {
			state,
			diagnostics,
			running: this.#turns.running,
			queued: this.#turns.queued,
			declaration: {
				kind: declaration.kind,
				valid: declaration.valid,
				members: declaration.members.map(({ id, name, version }) => ({ id, name, version })),
				diagnostics: declaration.diagnostics
			},
			lock: { path: join(this.#root, Execution.LOCK), digest: this.#digest() },
			execution: { path: join(this.#root, Execution.PATH), nodes: execution?.nodes.size ?? 0, written: execution?.written ?? null }
		};
	}

	/**
	 * The digest the lock of the workspace records, when it is a lock of the current protocol
	 */
	#digest() {
		try {
			const lock = JSON.parse(readFileSync(join(this.#root, this.#modules.Execution.LOCK), 'utf8'));
			return lock?.protocol === 'beyond-lock/2' && typeof lock.digest === 'string' ? lock.digest : null;
		} catch {
			return null;
		}
	}

	/**
	 * Installs the workspace once the installations asked for before have ended, if they end within the bound
	 *
	 * @param {{update?: boolean, offline?: boolean}} [options]
	 * @returns {Promise<{status: number, body: object}>} 200 with the report, 422 with the declaration errors, or
	 * 503 when this installation did not get its turn and was not started
	 */
	async install(options = {}) {
		if (!(await this.#turns.take(this.#queue))) return this.#busy();
		try {
			return await this.#run(options);
		} finally {
			this.#turns.release();
		}
	}

	#busy() {
		const message =
			`An installation of "${this.#root}" is in progress and did not end within ${this.#queue}ms, so this one was not ` +
			'started. Ask the service for the installation state (GET /installation) and install again once it ended; ' +
			'raise BEYOND_INSTALL_QUEUE_TIMEOUT to wait longer';
		return { status: 503, body: { error: { code: 'UNAVAILABLE', message } } };
	}

	async #run(options) {
		const { Declaration } = this.#modules;
		const declaration = Declaration.read(this.#root);
		if (!declaration.valid) {
			const errors = declaration.diagnostics.filter(({ severity }) => severity === 'error');
			const message = `The workspace "${this.#root}" is not declared correctly, so it is not installed: ${errors.map(({ message }) => message).join('; ')}`;
			return { status: 422, body: { error: { code: 'DECLARATION_INVALID', message, diagnostics: declaration.diagnostics } } };
		}

		const Installation = await this.#modules.installation();
		const installation = new Installation({
			root: this.#root,
			members: declaration.members.map(({ id, name, version, path, manifest }) => ({ id, name, version, path, manifest })),
			inputs: declaration.inputs,
			// The root manifest of a workspace: its dependency groups (when it is no member) and its overrides
			...(declaration.kind === 'standalone' ? {} : { manifest: declaration.manifest }),
			deadline: this.#deadline,
			logger: this.#logger
		});

		this.#log(`installing the workspace${Installer.#flags(options)}`);
		const report = await this.#holds.run(() => installation.install(options), this.#deadline + Installer.GRACE);
		const { counts = {} } = report;
		this.#log(`installation ${report.valid ? 'valid' : 'not valid'}: ${counts.nodes} nodes, ${counts.fetched} fetched, ${counts.reused} reused`);

		return { status: 200, body: report.execution?.written ? await this.#reloaded(report) : report };
	}

	/**
	 * Reloads the hosted workspace after an installation wrote its projection. A reload that does not settle is
	 * not a failed installation: the report says that the service still serves the previous workspace, and the
	 * next request that describes the workspace reloads it.
	 */
	async #reloaded(report) {
		try {
			await this.#hosted.reload();
			return report;
		} catch (error) {
			this.#log(`the workspace was not reloaded after the installation: ${error?.message}`);
			const message = `The installation was written, and the service did not reload the workspace yet: ${error?.message}. The next request that describes the workspace reloads it`;
			const diagnostic = { code: error?.code ?? 'UNAVAILABLE', message, severity: 'warning' };
			return { ...report, diagnostics: [...(report.diagnostics ?? []), diagnostic] };
		}
	}

	get #logger() {
		return {
			info: text => this.#log(`installation: ${text}`),
			warn: text => this.#log(`installation warning: ${text}`),
			error: text => this.#log(`installation error: ${text}`)
		};
	}

	/**
	 * The options of an installation as its log line names them
	 */
	static #flags({ update, offline }) {
		const named = [update && 'update', offline && 'offline'].filter(Boolean);
		return named.length ? ` (${named.join(', ')})` : '';
	}
}
