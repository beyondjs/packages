import type {
	IInstallationDiagnostic,
	IInstallationParams,
	IInstallationReport,
	IInstallOptions,
	IInstalledGraph
} from './types';
import type { IFetched } from './fetching';
import type { IWritten } from './writer';
import type { Deadline } from './deadline';
import { realpathSync } from 'fs';
import { resolve } from 'path';
import { LockFile } from './lock';
import { LockDocument } from './document';
import { Projection } from './projection';
import { Settings } from './settings';
import { Breaker } from './breaker';
import { Resolving } from './resolving';
import { Fetching } from './fetching';
import { Locations } from './locations';
import { Writer } from './writer';
import { Report } from './report';

/**
 * One installation of a workspace: read the lock, resolve unless the lock is the graph, fetch every external source,
 * locate every node, and only then write the lock and the projection, within the deadline of the installation.
 */
export class Run {
	#params: IInstallationParams;
	#options: IInstallOptions;
	#deadline: Deadline;
	#root: string;
	#lock: LockFile;
	#projection: Projection;
	#report: Report;

	constructor(params: IInstallationParams, options: IInstallOptions, deadline: Deadline) {
		this.#params = params;
		this.#options = options;
		this.#deadline = deadline;
		this.#root = Run.#canonical(params.root);
		this.#lock = new LockFile(this.#root);
		this.#projection = new Projection(this.#root);
		this.#report = new Report(this.#lock.path, this.#projection.path);
	}

	/**
	 * The report of an installation that ran out of time: nothing of it was or will be written
	 */
	timeout(): IInstallationReport {
		const seconds = Math.round(this.#deadline.milliseconds / 100) / 10;
		const message = `The installation did not finish within ${seconds} s: nothing was written`;
		return this.#report.fail('INSTALLATION_TIMEOUT', message);
	}

	/**
	 * Installs; it never rejects
	 */
	async execute(): Promise<IInstallationReport> {
		try {
			return await this.#execute();
		} catch (error) {
			const message = `The installation failed: ${error instanceof Error ? error.message : String(error)}`;
			return this.#report.fail('INSTALLATION_FAILED', message);
		}
	}

	async #execute(): Promise<IInstallationReport> {
		const { update = false, offline = false } = this.#options;
		const { inputs, members, limits } = this.#params;
		const [lock, report] = [this.#lock, this.#report];

		await lock.read();
		report.locked(lock.digest);
		if (lock.problem) report.add(this.#unreadable());

		const frozen =
			!update &&
			lock.covers(
				inputs,
				members.map(({ id }) => id)
			);
		report.frozen = frozen;
		if (offline && !frozen) return report.fail('OFFLINE_UNAVAILABLE', this.#unfrozen(update));

		const breaker = new Breaker(this.#deadline, this.#params.transport ?? this.#params.providers?.fetch);
		const settings = new Settings(this.#params, this.#root, breaker.transport);
		const graph = frozen ? lock.document : await this.#resolve(settings, update);
		if (!graph) return report.build();

		const store = await settings.store();
		const fetching = new Fetching(store, limits, () => settings.providers, breaker.transport, offline);
		const fetched = await fetching.run(graph);
		const counted = { members: Object.keys(graph.members).length, nodes: Object.keys(graph.nodes).length };
		report.counts = { ...counted, fetched: fetched.fetched, reused: fetched.reused };
		report.add(...fetched.diagnostics);
		if (!fetched.complete) return this.#incomplete(fetched);

		const locations = new Locations(this.#root, members);
		if (!(await locations.run(graph, fetched.locations))) {
			report.add(...locations.diagnostics);
			const count = locations.diagnostics.length;
			return report.fail(
				'SOURCES_INCOMPLETE',
				`${count} node(s) have no sources where expected: nothing was written`
			);
		}

		const document = LockDocument.compose(graph, inputs);
		let projection: string;
		try {
			const composed = this.#projection.compose({ lock: document, store, locations: locations.map });
			projection = LockDocument.text(composed);
		} catch (error) {
			return report.fail('GRAPH_INCOMPLETE', `The graph cannot be projected: ${error.message}`);
		}

		if (!this.#deadline.commit()) return this.timeout();
		const text = lock.differs(document) ? LockDocument.text(document) : void 0;
		const written = await new Writer(lock.path, this.#projection.path).write(text, projection);
		report.locked(written.lock || !text ? document.digest : lock.digest, written.lock);
		if (written.execution) report.projected();
		if (written.failure) return report.fail('INSTALLATION_WRITE_FAILED', this.#unwritten(written));
		return report.build();
	}

	async #resolve(settings: Settings, update: boolean): Promise<IInstalledGraph | undefined> {
		const preferences = this.#lock.readable ? this.#lock.data : void 0;
		const resolved = await new Resolving(this.#params, settings).run(preferences, update);
		this.#report.add(...resolved.diagnostics, ...settings.warnings);
		return resolved.graph;
	}

	/**
	 * Fails the report of sources that could not all be brought into the store: offline when what is missing could
	 * not be requested, incomplete otherwise
	 */
	#incomplete(fetched: IFetched): IInstallationReport {
		const nodes = fetched.diagnostics.filter(({ node }) => node);
		const missing = nodes.filter(({ code }) => code === 'OFFLINE_UNAVAILABLE').length;
		if (missing) {
			const message = `${missing} source(s) are not in the store and the installation is offline`;
			return this.#report.fail('OFFLINE_UNAVAILABLE', `${message}: nothing was written`);
		}
		const failed = nodes.length || 'Some';
		return this.#report.fail('SOURCES_INCOMPLETE', `${failed} source(s) could not be fetched: nothing was written`);
	}

	#unreadable(): IInstallationDiagnostic {
		const { path, problem, readable } = this.#lock;
		const kept = readable ? 'again, keeping its selections where they still apply' : 'without its selections';
		const message = `${path} was not used as the graph, ${problem}: the workspace is resolved ${kept}`;
		return { code: 'LOCK_UNREADABLE', message, severity: 'warning' };
	}

	#unfrozen(update: boolean): string {
		const offline = 'the installation is offline';
		if (update) return `An update resolves the workspace again, which needs the registries: ${offline}`;
		if (!this.#lock.document) {
			return `There is no usable ${LockFile.NAME} to install from without requests: ${offline}`;
		}
		const changed = 'the declaration or a member manifest changed';
		return `${LockFile.NAME} was recorded for other inputs (${changed}): ${offline}`;
	}

	/**
	 * What a write that stopped wrote, and what it did not
	 */
	#unwritten({ lock, failure }: IWritten): string {
		const why = `${failure.path} could not be written (${failure.code})`;
		if (lock) return `The lock was written, but ${why}: run beyond install again`;
		return `${why}: nothing was written`;
	}

	static #canonical(root: string): string {
		try {
			return realpathSync(root);
		} catch {
			return resolve(root);
		}
	}
}
