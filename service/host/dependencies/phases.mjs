/**
 * The phases an installation tells, shown on the steps of an operation: `resolution` on `resolve` (its metadata
 * requests counted, the package asked about as the current item), `download` on `fetch` (the external nodes as its
 * total, each archive answered counted as it arrives, and all of them once materialization starts, which it does only
 * when every source is in the store; a source the store already held makes no request), `materialization` on
 * `materialize`. A step begins when its phase begins and ends when the next one begins; the counts are those of
 * requests actually made, never an estimate.
 *
 * ```js
 * const phases = new Phases(operation);
 * const report = await installation.install({ preferences, progress: event => phases.tell(event) });
 * phases.end(report);
 * ```
 */
export class Phases {
	#operation;
	#current;
	#requests = 0;
	#archives = 0;
	#total;

	/**
	 * @param {import('../operations/operation.mjs').Operation} operation With the steps `resolve`, `fetch`, `materialize`
	 */
	constructor(operation) {
		this.#operation = operation;
	}

	#step(id) {
		return this.#operation.step(id);
	}

	#enter(id, phase) {
		this.#current && this.#step(this.#current).done();
		this.#current = id;
		this.#step(id).begin({ phase });
	}

	/**
	 * @param {{phase?: string, total?: number, request?: {url: string, kind: string, answered: boolean}}} event
	 */
	tell(event) {
		if (event.phase === 'resolution') return this.#enter('resolve', 'resolution');
		if (event.phase === 'download') {
			this.#current ?? this.#step('resolve').skip();
			this.#total = event.total;
			this.#enter('fetch', 'download');
			return this.#step('fetch').count(0, event.total, 'packages');
		}
		if (event.phase === 'materialization') {
			// Materialization starts only once every external source is in the store
			this.#current === 'fetch' && this.#step('fetch').count(this.#total ?? this.#archives, this.#total, 'packages');
			return this.#enter('materialize', 'materialization');
		}
		const { request } = event;
		if (!request) return;
		if (this.#current === 'resolve' && request.kind === 'metadata' && !request.answered) {
			this.#step('resolve').count(++this.#requests, undefined, 'requests').current(Phases.#package(request.url));
		}
		if (this.#current === 'fetch' && request.kind === 'archive' && request.answered) {
			this.#step('fetch').count(++this.#archives, this.#total, 'packages').current(Phases.#package(request.url));
		}
	}

	/**
	 * Ends the last step of an installation that answered well with the nodes it located; a failed one leaves its step
	 * in progress, for the operation's failure to end
	 *
	 * @param {{valid: boolean, counts: {nodes: number}}} report
	 */
	end(report) {
		if (!report.valid) return;
		const { nodes } = report.counts;
		this.#step('materialize').count(nodes, nodes, 'nodes').done();
	}

	/**
	 * The package a request names: the last segment of its path decoded, or the name before `/-/` of an archive
	 */
	static #package(url) {
		try {
			const path = new URL(url).pathname;
			const archive = /\/((?:@[^/]+(?:\/|%2F))?[^/]+)\/-\//i.exec(path);
			const segments = path.split('/').filter(Boolean);
			return decodeURIComponent(archive ? archive[1] : segments[segments.length - 1] ?? '');
		} catch {
			return void 0;
		}
	}
}
