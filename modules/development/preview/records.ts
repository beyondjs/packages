import type { IPreviewDiagnostic, IPreviewModule, IPreviewUpdatable } from './types';

/**
 * What a preview describes of the modules its graph reaches: one record per module of one package instance (by
 * the versioned identity of a module of the workspace, by source and version for an installed one), the
 * diagnostics of the graph, the runtimes its artifacts are assembled against and the modules a build can update.
 */
export class Records {
	#records: Map<string, IPreviewModule> = new Map();
	#diagnostics: IPreviewDiagnostic[] = [];
	#runtimes: Set<string> = new Set();
	#updatable: Record<string, IPreviewUpdatable> = {};

	get modules(): IPreviewModule[] {
		return [...this.#records.values()].sort((a, b) => a.specifier.localeCompare(b.specifier) || (a.version ?? '').localeCompare(b.version ?? ''));
	}

	get diagnostics(): IPreviewDiagnostic[] {
		return this.#diagnostics;
	}

	/**
	 * The runtime modules that the artifacts of the graph are assembled against
	 */
	get runtimes(): string[] {
		return [...this.#runtimes];
	}

	/**
	 * The modules of the graph that this environment serves in development, by specifier: the only ones a build
	 * can update, and all that the runtime of a page needs to know of the session to apply updates. A second
	 * version of a specifier is listed by its versioned identity, which is what the runtime reads.
	 */
	get updatable(): Record<string, IPreviewUpdatable> {
		return { ...this.#updatable };
	}

	/**
	 * The record of a module, by its id
	 */
	get(id: string): IPreviewModule | undefined {
		return this.#records.get(id);
	}

	/**
	 * Records a module under its id
	 *
	 * @returns The record
	 */
	add(id: string, record: IPreviewModule): IPreviewModule {
		this.#records.set(id, record);
		return record;
	}

	/**
	 * Every record with its id
	 */
	entries(): IterableIterator<[string, IPreviewModule]> {
		return this.#records.entries();
	}

	/**
	 * Adds a diagnostic of the graph, once
	 */
	report(code: string, message: string): void {
		!this.#diagnostics.some(one => one.code === code && one.message === message) && this.#diagnostics.push({ code, message });
	}

	/**
	 * Records a runtime module an artifact of the graph is assembled against
	 */
	runtime(specifier: string): void {
		this.#runtimes.add(specifier);
	}

	/**
	 * Lists a module in development for the runtime of the page
	 */
	update(specifier: string, updatable: IPreviewUpdatable): void {
		const current = this.#updatable[specifier];
		const key = !current || current.vspecifier === updatable.vspecifier ? specifier : updatable.vspecifier;
		this.#updatable[key] = updatable;
	}
}
