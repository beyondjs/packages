/**
 * The process that consumes the artifacts produced by Packages.
 *
 * It is deliberately an ordinary Node process: it knows nothing about Packages, it imports the public
 * modules by their bare specifiers, and the loader resolves them through the import map that the build
 * wrote. Loading it this way is what makes the result meaningful, because it shows that the artifacts are
 * executable on their own rather than through the compiler that produced them.
 *
 * The process stays alive between requests so that updates apply to modules that are already loaded, and
 * reports what it observes to the driver: the values read through the original imports, the identities
 * registered in the runtime, and how many times each source file of the fixture was evaluated.
 */
import { pathToFileURL } from 'node:url';

const send = message => process.send(message);

let app, shared, kernel;

// Each update is requested at its own URL, because a module already loaded from a URL is never fetched again
let updates = 0;

/**
 * What the consumer observes, read through the imports it made when it started: the public API of both
 * modules, the runtime registry, and the evaluation counters the fixture sources increment
 */
const observe = () => ({
	main: app.main(),
	custom: app.custom('World'),
	message: shared.message,
	greet: shared.greet('World'),
	sharedExports: Object.keys(shared).sort(),
	appExports: Object.keys(app).sort(),
	instances: [...kernel.instances.keys()].sort(),
	identities: {
		shared: kernel.instances.get('@suite/shared@0.1.0/message')?.package().vspecifier,
		app: kernel.instances.get('@suite/app@0.1.0/main')?.package().vspecifier
	},
	evaluations: Object.assign({}, globalThis.evaluations)
});

const handlers = {
	/**
	 * Imports the two public modules and the runtime, and keeps the runtime packages to compare their
	 * identity after an update
	 */
	async load() {
		kernel = await import('@beyond-js/kernel/bundle');
		app = await import('@suite/app/main');
		shared = await import('@suite/shared/message');

		globalThis.__packages = {
			shared: kernel.instances.get('@suite/shared@0.1.0/message'),
			app: kernel.instances.get('@suite/app@0.1.0/main')
		};
		return observe();
	},

	/**
	 * Applies an update: importing it runs its code, which addresses the package already registered under
	 * the same identity and replaces the internal modules whose content changed
	 */
	async patch({ file }) {
		const url = `${pathToFileURL(file).href}?hmr=${++updates}`;
		await import(url);

		const identity = {
			shared: kernel.instances.get('@suite/shared@0.1.0/message') === globalThis.__packages.shared,
			app: kernel.instances.get('@suite/app@0.1.0/main') === globalThis.__packages.app
		};
		return Object.assign(observe(), { identity });
	},

	/**
	 * Exits cleanly, after answering, so the driver can assert the exit code
	 */
	async exit() {
		setImmediate(() => process.exit(0));
		return {};
	}
};

process.on('message', async ({ id, action, params }) => {
	try {
		const result = await handlers[action](params ?? {});
		send({ id, result });
	} catch (error) {
		send({ id, error: error.stack ?? String(error) });
	}
});

send({ ready: true });
