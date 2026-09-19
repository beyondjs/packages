/**
 * The consumer of the end-to-end validation: an ordinary Node process that loads the public modules from a
 * development service, registers that service in the runtime and then only waits. Nobody tells it which
 * update to import: what it reports is what the runtime applied after the service announced a build.
 */
const { SERVICE_ORIGIN } = process.env;
const loaded = new Map();
const events = [];
const waiting = new Set();

const record = (type, ...values) => {
	events.push([type, ...values.map(value => (value instanceof Error ? value.message : value))]);
	waiting.forEach(check => check());
};

const handlers = {
	async start({ specifiers }) {
		for (const [handle, specifier] of Object.entries(specifiers)) loaded.set(handle, await import(specifier));

		const { local } = await import('@beyond-js/local-2026/main');
		await local.register({ origin: SERVICE_ORIGIN, retries: [100, 200, 400, 800, 1600] });
		['applied', 'error', 'invalid', 'reload', 'stale'].forEach(type => local.hmr.on(type, (...values) => record(type, ...values)));
		local.connection.on('state', state => record('connection', state));
		for (const handle of loaded.keys()) loaded.get(handle).hmr.on('change', () => record('change', handle));
		globalThis.local = local;
		return { state: local.connection.state };
	},

	async call({ handle, name, args = [] }) {
		return loaded.get(handle)[name](...args);
	},

	async read({ handle, name }) {
		return loaded.get(handle)[name];
	},

	async evaluations() {
		return Object.assign({}, globalThis.evaluations);
	},

	async registry() {
		const { instances } = await import('@beyond-js/local-2026/bundle');
		return [...instances.keys()].sort();
	},

	/**
	 * Resolves when an event of the given type was recorded after position `from`, and the queue of updates is empty
	 */
	async until({ type, from = 0, ms = 15000 }) {
		const found = () => events.slice(from).some(([name]) => name === type);
		await new Promise((resolve, reject) => {
			const check = () => found() && (waiting.delete(check), clearTimeout(timer), resolve());
			const timer = setTimeout(() => (waiting.delete(check), reject(new Error(`No "${type}" event: ${JSON.stringify(events.slice(from))}`))), ms);
			waiting.add(check);
			check();
		});
		await globalThis.local.hmr.idle;
		return events.length;
	},

	async events({ from = 0 }) {
		return events.slice(from);
	},

	async close() {
		globalThis.local.close();
		return { registered: globalThis.local.registered };
	},

	async exit() {
		setImmediate(() => process.exit(0));
		return {};
	}
};

process.on('message', async ({ id, action, params }) => {
	try {
		process.send({ id, result: await handlers[action](params ?? {}) });
	} catch (error) {
		process.send({ id, error: error.stack ?? String(error) });
	}
});

process.send({ ready: true });
