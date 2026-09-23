/**
 * The consumer of the environments validation. The same file runs in Node.js, under BEE Node resolving
 * from the development service, and in Deno, resolving through an import map of the service: it imports
 * public modules by bare specifier, registers the service in the development runtime and then only
 * reports what the runtime applied. Nobody tells it which update to import.
 *
 * `CONSUMER_EVENTS` selects where the notifications come from, which is what the runtime is given as
 * `events`: `stream` (omitted: the event stream of the service), `object` (an object source whose listener
 * the driver feeds), `notify` (no source: the driver's notifications are given to `local.hmr.notify()`),
 * or the URL of another event stream.
 *
 * It speaks to the driver over its standard streams: a request per line on stdin, `{id, action, params}`,
 * and each answer on a stdout line prefixed with `@@`, so that anything else a module prints is not read.
 */
const deno = globalThis.Deno;
const env = deno ? deno.env.toObject() : process.env;
const { SERVICE_ORIGIN, CONSUMER_EVENTS = 'stream' } = env;

const loaded = new Map();
const events = [];
const waiting = new Set();
let local;
let listener;

const record = (type, ...values) => {
	events.push([type, ...values.map(value => (value instanceof Error ? value.message : value))]);
	waiting.forEach(check => check());
};

/**
 * What the runtime is given as `events`
 */
const source = () => {
	if (CONSUMER_EVENTS === 'stream') return void 0;
	if (CONSUMER_EVENTS === 'notify') return false;
	if (CONSUMER_EVENTS !== 'object') return CONSUMER_EVENTS;
	return {
		subscribe(received) {
			listener = received;
			return () => (listener = void 0);
		}
	};
};

const handlers = {
	async start({ specifiers }) {
		for (const [handle, specifier] of Object.entries(specifiers)) loaded.set(handle, await import(specifier));

		({ local } = await import('@beyond-js/local-2026/main'));
		await local.register({ origin: SERVICE_ORIGIN, events: source(), retries: [100, 200, 400, 800, 1600, 3200] });
		['applied', 'styles', 'error', 'invalid', 'reload', 'stale'].forEach(type => local.hmr.on(type, (...values) => record(type, ...values)));
		local.connection.on('state', state => record('connection', state));
		local.connection.on('event', (type, event) => type === 'build.ended' && record('notified', event.build?.id));
		for (const handle of loaded.keys()) loaded.get(handle).hmr.on('change', () => record('change', handle));

		const { host, connection } = local;
		return { state: connection.state, source: connection.source, platform: host.platform, environment: host.environment, loader: host.loader };
	},

	/**
	 * A notification of the driver, which stands for an external emitter
	 */
	async deliver({ event }) {
		if (CONSUMER_EVENTS === 'notify') {
			event.type === 'build.ended' && record('notified', event.build?.id);
			return void (await local.hmr.notify(event));
		}
		if (CONSUMER_EVENTS !== 'object') throw new Error(`This consumer receives its notifications from "${CONSUMER_EVENTS}"`);
		listener?.(event);
	},

	/**
	 * What `notify` answers to something that is not a notification
	 */
	async refusal({ event }) {
		try {
			await local.hmr.notify(event);
			return null;
		} catch (error) {
			return `${error.name}: ${error.message}`;
		}
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
	 * The stylesheet of a module as the registry of the runtime holds it
	 */
	async stylesheet({ vspecifier }) {
		const { styles } = await import('@beyond-js/local-2026/bundle');
		const entry = styles.get(vspecifier);
		return entry ? { href: entry.href, version: entry.version } : null;
	},

	/**
	 * Resolves when an event of the given type, with the given first value when one is given, was recorded
	 * after position `from`, and the queue of updates is empty
	 */
	async until({ type, value, from = 0, ms = 30000 }) {
		const found = () => events.slice(from).some(([name, first]) => name === type && (value === void 0 || first === value));
		await new Promise((resolve, reject) => {
			const check = () => found() && (waiting.delete(check), clearTimeout(timer), resolve());
			const timer = setTimeout(() => (waiting.delete(check), reject(new Error(`No "${type}" event: ${JSON.stringify(events.slice(from))}`))), ms);
			waiting.add(check);
			check();
		});
		await local.hmr.idle;
		return events.length;
	},

	async events({ from = 0 }) {
		return events.slice(from);
	},

	async close() {
		local.close();
		return { registered: local.registered };
	},

	async exit() {
		setTimeout(() => (deno ? deno.exit(0) : process.exit(0)));
	}
};

const answer = message => {
	const line = `@@${JSON.stringify(message)}\n`;
	deno ? deno.stdout.writeSync(new TextEncoder().encode(line)) : process.stdout.write(line);
};

const handle = async line => {
	if (!line.trim()) return;
	const { id, action, params } = JSON.parse(line);
	try {
		answer({ id, result: (await handlers[action](params ?? {})) ?? null });
	} catch (error) {
		answer({ id, error: error?.stack ?? String(error) });
	}
};

/**
 * The lines of the standard input, read with what the environment provides
 */
const lines = async function* () {
	const chunks = deno ? deno.stdin.readable.pipeThrough(new TextDecoderStream()) : process.stdin.setEncoding('utf8');
	let pending = '';
	for await (const chunk of chunks) {
		pending += chunk;
		for (let end; (end = pending.indexOf('\n')) !== -1; pending = pending.slice(end + 1)) yield pending.slice(0, end);
	}
};

answer({ ready: true });
for await (const line of lines()) handle(line);
