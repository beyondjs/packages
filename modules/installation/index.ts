import type {
	IInstallationParams,
	IInstallationReport,
	IInstallOptions,
	IReleases,
	IReleasesOptions,
	IResolution,
	IResolveOptions
} from './types';
import { Deadline } from './deadline';
import { Run } from './run';
import { Probe } from './probe';
import { Serial } from './serial';

/**
 * The installation of a local workspace: it resolves the whole workspace with the resolver of Packages, fetches
 * every external node into the source store of the user, and only then writes the lock (`beyond-lock.json`,
 * `beyond-lock/2`) and the execution projection (`.beyond/execution.json`, `beyond-execution/1`), each atomically.
 *
 * - A sound `beyond-lock/2` lock recorded from the current inputs is the graph: the installation is frozen, no
 *   resolution runs and no metadata is requested. `update` resolves again ignoring the lock's selections. A lock
 *   that is not sound is `LOCK_UNREADABLE`, and its selections are kept as preferences of a new resolution.
 * - `preferences` replace the lock's selections, as an accepted plan pins them: the workspace is then always
 *   resolved, with them, and never with `update`.
 * - The lock is rewritten unless what it holds is sound and has the new digest; it records `access` on private
 *   nodes only, so everyone who resolves the workspace writes the same lock.
 * - Offline, only a frozen installation whose sources are all in the store succeeds (`OFFLINE_UNAVAILABLE`).
 * - A graph with errors is `GRAPH_INCOMPLETE`, a source that could not be fetched `SOURCES_INCOMPLETE`: nothing is
 *   written, so the previous lock and projection stay as they were. A write that stops says what it wrote
 *   (`INSTALLATION_WRITE_FAILED`). Every failure is in the report; `install()` never rejects for one.
 * - A provider that fails at the network level is not asked again in that installation, and the whole installation
 *   is bounded (`BEYOND_INSTALL_DEADLINE`, 540000 ms by default): past it the answer is `INSTALLATION_TIMEOUT`,
 *   and nothing is written.
 * - The projection records every location by its real path: the root, the members, the store and its sources.
 * - The installations of one root run one at a time in a process, whichever instance asks for them: the development
 *   service creates one per request, and dependency management one per accepted plan.
 *
 * `resolve()` and `releases()` install nothing: they read what an installation would read, through the same
 * settings, metadata cache, transport and bounds, and do not wait for an installation that runs.
 */
export /*bundle*/ class Installation {
	// The queue of the installations of each canonical root of this process
	static #serials: Map<string, Serial> = new Map();

	#params: IInstallationParams;
	#serial: Serial;

	/**
	 * @param params The workspace as its declaration reads it, and where and how to install it
	 * @throws When the root or the list of members is missing: a programming error, not a failed installation
	 */
	constructor(params: IInstallationParams) {
		if (!params || typeof params.root !== 'string' || !params.root) {
			throw new Error('The workspace root is required');
		}
		if (!Array.isArray(params.members)) throw new Error('The members of the workspace are required');
		this.#params = params;

		const root = Run.canonical(params.root);
		if (!Installation.#serials.has(root)) Installation.#serials.set(root, new Serial());
		this.#serial = Installation.#serials.get(root);
	}

	/**
	 * Installs the workspace and answers what was done, within the deadline of the installation. Past it, the answer
	 * is `INSTALLATION_TIMEOUT` at once, while the requests still running are aborted; the next call starts once
	 * they ended.
	 */
	async install(options: IInstallOptions = {}): Promise<IInstallationReport> {
		return await new Promise<IInstallationReport>(answer => {
			void this.#serial.run(async () => {
				const deadline = new Deadline(this.#params.deadline);
				const run = new Run(this.#params, options || {}, deadline);
				void deadline.reached.then(() => answer(run.timeout()));
				answer(await run.execute());
				deadline.clear();
			});
		});
	}

	/**
	 * Resolves the whole workspace as an installation with the same options would, and answers the graph, the digest
	 * of the lock it would write, the diagnostics and the measured work, without fetching or writing anything. Past
	 * the deadline of an installation the answer is `RESOLUTION_TIMEOUT`; cancelled through `signal`,
	 * `RESOLUTION_CANCELLED`. It never rejects for a failure: an unexpected one is `RESOLUTION_FAILED`.
	 */
	async resolve(options: IResolveOptions = {}): Promise<IResolution> {
		return await new Probe(this.#params, Run.canonical(this.#params.root)).resolve(options || {});
	}

	/**
	 * The releases the configured providers publish for each name, read now (a cached document is revalidated with
	 * a conditional request), in the order given and each name once, within the deadline of an installation. A name
	 * that could not be read says why; the call rejects only when the names are not a list, a programming error.
	 */
	async releases(names: string[], options: IReleasesOptions = {}): Promise<IReleases[]> {
		if (!Array.isArray(names)) throw new Error('The names of the packages are required');
		return await new Probe(this.#params, Run.canonical(this.#params.root)).releases(names, options || {});
	}
}
