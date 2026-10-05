/**
 * Which public module a selector names, and whether what executing it needs builds (`GET /selection`).
 *
 * A module is executed by a Node consumer, so its graph is checked for Node. A module that builds for browsers
 * only is not one that fails: it is opened in a browser, through the preview of the development extension. Its
 * answer says so (`browser: true`), checks its graph for browsers instead, and gives the address of its preview
 * relative to the service, or null when the service was started without the development extension, which is
 * what serves the preview.
 */
export class Selection {
	/**
	 * The extension that serves the preview of the workspace
	 */
	static DEVELOPMENT = '@beyond-js/packages/development';

	#delivery;
	#graph;
	#previews;

	/**
	 * @param {object} delivery The hosted workspace
	 * @param {import('./graph.mjs').Graph} graph The graph of an entry, checked for Node consumers by default
	 * @param {{previews: boolean}} options Whether the preview is served, because the development extension is
	 * mounted
	 */
	constructor(delivery, graph, { previews }) {
		this.#delivery = delivery;
		this.#graph = graph;
		this.#previews = previews;
	}

	/**
	 * @param {string} selector
	 * @param {string} [directory] Where a local selector is resolved from
	 * @returns {Promise<{status: number, body: object}>}
	 */
	async answer(selector, directory) {
		const { selected, errors } = await this.#delivery.selection.resolve(selector, directory);
		if (!selected) return { status: 404, body: { error: { ...errors[0], diagnostics: errors } } };

		const { specifier, vspecifier, subpath } = selected;
		const { name, version } = selected.package;
		const entry = { name, version, subpath, vspecifier };
		const described = { specifier, vspecifier, name, version, subpath };

		const checked = await this.#graph.check(entry);
		if (!Selection.#browser(checked, vspecifier)) return { status: 200, body: { selected: described, ...checked } };

		const web = await this.#graph.check(entry, { ...this.#graph.conditions, platform: 'web' });
		return { status: 200, body: { selected: described, browser: true, preview: await this.#preview(described), ...web } };
	}

	/**
	 * Whether the entry itself declares no build for Node, which is how a browser module fails a Node check
	 */
	static #browser({ failures }, vspecifier) {
		const failure = failures.find(one => one.vspecifier === vspecifier);
		return !!failure?.diagnostics?.length && failure.diagnostics.every(({ code }) => code === 'CONDITIONAL_NOT_FOUND');
	}

	/**
	 * The address of the preview of an entry: named by its specifier, or by its versioned identity when several
	 * local versions publish that specifier, so the preview never takes the first of them
	 */
	async #preview({ specifier, vspecifier }) {
		if (!this.#previews) return null;
		const published = await this.#delivery.published();
		const shared = published.filter(module => module.specifier === specifier).length > 1;
		return `/preview/?entry=${encodeURIComponent(shared ? vspecifier : specifier)}`;
	}

	/**
	 * Mounts `GET /selection?selector=&directory=`
	 *
	 * @param {import('express').Application} app
	 */
	setup(app) {
		app.get('/selection', (request, response, next) => {
			const { selector, directory } = request.query;
			this.answer(String(selector ?? ''), directory ? String(directory) : void 0).then(
				({ status, body }) => response.status(status).json(body),
				next
			);
		});
	}
}
