/**
 * The transport an installation is given: every request it makes, for metadata and for archives, goes through
 * it. It records when each request starts and when its answer is complete, in one sequence, which is how a test
 * proves that the whole graph was resolved before the first archive was requested.
 *
 * A metadata answer is read whole before it is handed on, so its end is the moment its document is available to
 * the resolution; an archive is handed on as a stream, and only its start matters.
 */
export class Recorder {
	#events = [];

	/**
	 * Every event, in order: `{type: 'start' | 'end', kind: 'metadata' | 'archive', url, status?}`
	 */
	get events() {
		return [...this.#events];
	}

	/**
	 * The URLs of the requests that started, in order, optionally of one kind
	 */
	requests(kind) {
		return this.#events.filter(event => event.type === 'start' && (!kind || event.kind === kind)).map(({ url }) => url);
	}

	/**
	 * The transport function, as `fetch` is called
	 */
	get fetch() {
		return (url, init) => this.#request(url, init);
	}

	/**
	 * The kind of a request, judged by the address the npm registry protocol gives archives
	 */
	static kind(url) {
		return /\/-\/[^/]+\.tgz$/.test(new URL(url).pathname) ? 'archive' : 'metadata';
	}

	/**
	 * Forgets the requests recorded so far
	 */
	reset() {
		this.#events = [];
	}

	async #request(url, init) {
		const address = String(url);
		const kind = Recorder.kind(address);
		this.#events.push({ type: 'start', kind, url: address });
		if (kind === 'archive') return fetch(url, init);

		try {
			const response = await fetch(url, init);
			const body = await response.arrayBuffer();
			this.#events.push({ type: 'end', kind, url: address, status: response.status });
			// A status that has no body (a revalidated document) cannot be given one
			const empty = [204, 205, 304].includes(response.status);
			const { status, statusText, headers } = response;
			return new Response(empty ? null : body, { status, statusText, headers });
		} catch (error) {
			this.#events.push({ type: 'end', kind, url: address, error: error.message });
			throw error;
		}
	}
}
