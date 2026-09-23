/**
 * A browser page of a preview, as the updates validation observes it: what the fixture element shows, the
 * stylesheet of the document, and what the development runtime of the page reports. Nothing here applies
 * an update: the page's own runtime does.
 */
const RUNTIME = '@beyond-js/local-2026/main';

export class Viewer {
	#name;
	get name() {
		return this.#name;
	}

	#page;
	get page() {
		return this.#page;
	}

	#observed;
	get observed() {
		return this.#observed;
	}

	#seen = 0;
	#system;

	/**
	 * @param opened A page of `Browser.page()`
	 * @param system Whether the page loads its modules with SystemJS
	 */
	constructor(name, { page, observed }, system = false) {
		this.#name = name;
		this.#page = page;
		this.#observed = observed;
		this.#system = system;
	}

	/**
	 * Gives the page `window.runtime()`, which imports the runtime with the loader of the page's modules:
	 * the browser's, or SystemJS
	 */
	#define() {
		const define = ({ specifier, system }) => (window.runtime = () => (system ? System.import(specifier) : import(specifier)));
		return this.#page.evaluate(define, { specifier: RUNTIME, system: this.#system });
	}

	/**
	 * Opens the preview and waits for the element the application adds
	 */
	async open(url, selector = 'fixture-counter') {
		await this.#page.goto(url);
		await this.#page.waitForSelector(selector);
		await this.#define();
		await this.watch();
		return this;
	}

	/**
	 * Records in the page what the runtime reports from now on
	 */
	watch() {
		return this.#page.evaluate(async () => {
			const { local } = await window.runtime();
			const updates = (window.updates ??= []);
			const record = (type, ...values) => updates.push([type, ...values.map(value => (value instanceof Error ? value.message : Array.isArray(value) ? value.length : value))]);
			['applied', 'styles', 'error', 'invalid', 'reload', 'stale'].forEach(type => local.hmr.on(type, (...values) => record(type, ...values)));
			local.connection.on('event', (type, event) => type === 'build.ended' && record('notified', event.build?.id));
			local.connection.on('state', state => record('connection', state));
		});
	}

	/**
	 * Registers the page's runtime again with other settings, and records what it reports
	 *
	 * @param settings What the page is given besides its origin: `events`, `session`, `options`
	 */
	async register(settings) {
		await this.#page.evaluate(async settings => {
			const { local } = await window.runtime();
			local.close();
			await local.register({ origin: new URL('..', document.baseURI).href, ...settings });
		}, settings);
		await this.watch();
	}

	/**
	 * What the runtime of the page says of itself
	 */
	describe() {
		return this.#page.evaluate(async () => {
			const { host, connection } = (await window.runtime()).local;
			return { state: connection.state, source: connection.source, platform: host.platform, environment: host.environment, loader: host.loader };
		});
	}

	shown() {
		return this.#page.locator('fixture-counter p').textContent();
	}

	click() {
		return this.#page.locator('fixture-counter button').click();
	}

	/**
	 * Waits until the element shows a text
	 */
	text(expected, ms = 60000) {
		const shown = expected => document.querySelector('fixture-counter')?.shadowRoot?.querySelector('p')?.textContent.includes(expected);
		return this.#page.waitForFunction(shown, expected, { timeout: ms });
	}

	/**
	 * The computed color of the document's text, which the linked stylesheet of the entry module sets
	 */
	ink() {
		return this.#page.evaluate(() => getComputedStyle(document.body).color);
	}

	/**
	 * The addresses of the stylesheet links the runtime replaces
	 */
	links() {
		return this.#page.evaluate(() => [...document.querySelectorAll('link[data-beyond-styles]')].map(link => link.getAttribute('href')));
	}

	/**
	 * Waits until the runtime reported an event of a type (with a first value, when given) after the ones
	 * already observed, and its queue of updates is empty
	 */
	async until(type, value, ms = 60000) {
		const found = ({ type, value, from }) => (window.updates ?? []).slice(from).some(([name, first]) => name === type && (value === null || first === value));
		await this.#page.waitForFunction(found, { type, value: value ?? null, from: this.#seen }, { timeout: ms });
		await this.#page.evaluate(async () => (await window.runtime()).local.hmr.idle);
		return this.#mark();
	}

	/**
	 * What the runtime reported after position `from`
	 */
	events(from = 0) {
		return this.#page.evaluate(from => (window.updates ?? []).slice(from), from);
	}

	/**
	 * Closes the runtime's connection
	 *
	 * @returns Whether it is still registered
	 */
	close() {
		return this.#page.evaluate(async () => {
			const { local } = await window.runtime();
			local.close();
			return local.registered;
		});
	}

	get seen() {
		return this.#seen;
	}

	async #mark() {
		const before = this.#seen;
		this.#seen = await this.#page.evaluate(() => (window.updates ?? []).length);
		return before;
	}
}
