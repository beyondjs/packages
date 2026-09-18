/**
 * The process that consumes the artifacts of the trial.
 *
 * It imports public modules by bare specifier through the import map the build wrote, and keeps every
 * namespace it loaded, so the driver can ask a module that is already loaded again after a rebuild. It
 * imports no Beyond runtime itself: whether one is loaded depends only on the mode of the artifacts.
 */
const loaded = new Map();

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
	 * The runtime packages registered by the artifacts that use the runtime, or null when none was loaded
	 */
	async runtime() {
		const kernel = await import('@beyond-js/kernel/bundle').catch(() => null);
		return kernel ? [...kernel.instances.keys()].sort() : null;
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
