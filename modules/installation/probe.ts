import type {
	IInstallationDiagnostic,
	IInstallationEvent,
	IInstallationParams,
	IInstalledGraph,
	IReleases,
	IReleasesOptions,
	IResolution,
	IResolveOptions
} from './types';
import type { IWorkspaceGraph } from '@beyond-js/packages/resolution';
import { Deadline } from './deadline';
import { Breaker } from './breaker';
import { Settings } from './settings';
import { LockFile } from './lock';
import { LockDocument } from './document';
import { Resolving } from './resolving';
import { Releases } from './releases';

/**
 * Work on a workspace that installs nothing: resolving it as an installation would (the graph, the lock it would
 * write and the published releases of the names asked for), and reading the releases of names. Both read through
 * what an installation reads through (its provider settings, the user's metadata cache, its transport, the breaker
 * of unreachable providers and its deadline), so what they establish is what an installation would find. Nothing is
 * fetched or written; both answer instead of rejecting.
 */
export class Probe {
	#params: IInstallationParams;
	#root: string;

	/**
	 * @param root The canonical workspace root
	 */
	constructor(params: IInstallationParams, root: string) {
		this.#params = params;
		this.#root = root;
	}

	get #transport() {
		return this.#params.transport ?? this.#params.providers?.fetch;
	}

	/**
	 * Resolves the whole workspace with the given preferences, or with the lock's when none are given
	 */
	async resolve(options: IResolveOptions): Promise<IResolution> {
		const deadline = new Deadline(this.#params.deadline);
		const started = Date.now();
		const tell = (event: IInstallationEvent) => Probe.#tell(options.progress, event);
		const listener = (request: IInstallationEvent['request']) => tell({ request });
		const breaker = new Breaker(deadline, this.#transport, { listener, signal: options.signal });
		const answer = (diagnostics: IInstallationDiagnostic[], fields: Partial<IResolution> = {}): IResolution => {
			const { metadata } = breaker.requests;
			return { valid: false, diagnostics, requests: metadata, duration: Date.now() - started, releases: [], ...fields };
		};
		const seconds = Math.round(deadline.milliseconds / 100) / 10;
		const late = deadline.reached.then(() => answer([Probe.#error('RESOLUTION_TIMEOUT', `The resolution did not finish within ${seconds} s`)]));

		const work = (async (): Promise<IResolution> => {
			const { preferences, update = false, names = [], signal } = options;
			if (update && preferences !== void 0) {
				const message = 'An update offers no preferences, and preferences are not combined with an update';
				return answer([Probe.#error('INSTALLATION_OPTIONS_INVALID', message)]);
			}
			const settings = new Settings(this.#params, this.#root, breaker.transport);
			const lock = preferences !== void 0 || update ? preferences : await this.#lock();
			tell({ phase: 'resolution' });
			const resolved = await new Resolving(this.#params, settings).run(lock, update);
			if (signal?.aborted) return answer([Probe.#error('RESOLUTION_CANCELLED', 'The resolution was cancelled')]);

			const graph = resolved.document ? Probe.#graph(resolved.document) : void 0;
			const digest = graph ? LockDocument.compose(graph, this.#params.inputs).digest : void 0;
			const releases = names.length ? await new Releases(await settings.metadata(), signal).read(names) : [];
			// A resolution installs nothing: its summary of the errors says only that the graph has them
			const summary = (diagnostic: IInstallationDiagnostic) =>
				diagnostic.code === 'GRAPH_INCOMPLETE' ? { ...diagnostic, message: diagnostic.message.replace(/: nothing was installed$/, '') } : diagnostic;
			const diagnostics = [...resolved.diagnostics.map(summary), ...settings.warnings];
			return answer(diagnostics, { valid: !!resolved.graph, ...(graph ? { graph, lock: digest } : {}), releases });
		})().catch(error => answer([Probe.#error('RESOLUTION_FAILED', `The resolution failed: ${error?.message ?? error}`)]));

		try {
			return await Promise.race([work, late]);
		} finally {
			deadline.clear();
		}
	}

	/**
	 * The releases of each name, read within the deadline of an installation
	 */
	async releases(names: string[], options: IReleasesOptions): Promise<IReleases[]> {
		const deadline = new Deadline(this.#params.deadline);
		const breaker = new Breaker(deadline, this.#transport, { signal: options.signal });
		const unread = (code: string, message: string) => [...new Set(names)].map(name => Releases.unread(name, code, message));
		const seconds = Math.round(deadline.milliseconds / 100) / 10;
		const late = deadline.reached.then(() => unread('RESOLUTION_TIMEOUT', `The releases were not read within ${seconds} s`));

		const work = (async () => {
			const settings = new Settings(this.#params, this.#root, breaker.transport);
			return await new Releases(await settings.metadata(), options.signal).read(names, options.progress);
		})().catch(error => unread('RESOLUTION_FAILED', `The releases could not be read: ${error?.message ?? error}`));

		try {
			return await Promise.race([work, late]);
		} finally {
			deadline.clear();
		}
	}

	/**
	 * The content of the lock file, offered as preferences as an installation offers it
	 */
	async #lock(): Promise<any> {
		const file = new LockFile(this.#root);
		await file.read();
		return file.readable ? file.data : void 0;
	}

	/**
	 * The parts of a workspace graph that an installation locks and projects
	 */
	static #graph({ members, nodes, edges, overrides, exceptions }: IWorkspaceGraph): IInstalledGraph {
		return <IInstalledGraph>(<unknown>{ members, nodes, edges, overrides, exceptions });
	}

	static #error(code: string, message: string): IInstallationDiagnostic {
		return { code, message, severity: 'error' };
	}

	static #tell(progress: IResolveOptions['progress'], event: IInstallationEvent): void {
		try {
			progress?.(event);
		} catch {
			// Whoever listens never changes the resolution
		}
	}
}
