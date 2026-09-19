/**
 * The process that consumes the artifacts of the unified-runtime validation.
 *
 * It imports public modules by bare specifier through the import map of the build and stays alive, so an
 * update is applied to modules that are already loaded. It reports what it observes through the namespaces
 * it imported when it started: values, the registry of the runtime the artifacts name, and how many times
 * each source file of the fixture was evaluated.
 */
import { pathToFileURL } from 'node:url';

const loaded = new Map();
let updates = 0;

const handlers = {
	async load({ handle, specifier }) {
		loaded.set(handle, await import(specifier));
		return Object.keys(loaded.get(handle)).sort();
	},

	async call({ handle, name, args = [] }) {
		return loaded.get(handle)[name](...args);
	},

	async read({ handle, name }) {
		return loaded.get(handle)[name];
	},

	/**
	 * The versioned identities registered in a runtime, or null when that runtime cannot be resolved here
	 */
	async registry({ specifier }) {
		const runtime = await import(specifier).catch(() => null);
		return runtime ? [...runtime.instances.keys()].sort() : null;
	},

	async evaluations() {
		return Object.assign({}, globalThis.evaluations);
	},

	/**
	 * Applies an update file. Each one is imported at its own URL, because a URL is evaluated only once.
	 * The driver names the file, so this is the application of an update, not its delivery.
	 */
	async patch({ file }) {
		await import(`${pathToFileURL(file).href}?update=${++updates}`);
		return updates;
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
