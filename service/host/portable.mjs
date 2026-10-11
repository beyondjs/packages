import { createServer } from 'node:http';
import { ExportRoutes } from './exports/routes.mjs';
import { Exports } from './exports/exports.mjs';
import { Hosts } from './hosts.mjs';
import { Interface } from './interface.mjs';
import { Pairing } from './pairing/index.mjs';

/**
 * What a service started with the `pairing` setting adds so that the Packages interface can use it from a browser,
 * as the command line starts it: two listeners, pairing and the access policy (`beyond-dev-pairing/1`), durable source
 * exports and their transfer to Snapshots (`beyond-dev-exports/1`), and the interface itself served at `/ui/` when the
 * service was given a build of it (`interface`).
 *
 * **Two listeners.** The API listener (`service.origin`) serves the session, the state, the files, the events, the
 * builds, the selection, the installation, the exports, pairing and the fallback interface. The preview listener
 * (`service.preview`), on a port of its own, serves only what a preview page loads. Code that runs in a preview, the
 * application's and its dependencies', never shares an origin with the API or the interface, so it can read no token
 * and reach no privileged route.
 *
 * ```js
 * const portable = new Portable(settings, { hosts, events, session, announce });
 * portable.guard(app);                      // before every route, after the Host check
 * portable.setup(app);                      // the routes of pairing, exports and the interface
 * await portable.start();
 * await portable.listen(app, { port, address });   // opens the preview listener: {preview, publics}
 * ```
 *
 * A service started without the setting does not construct this and behaves as before; the Conduict runner, which
 * starts the service behind its own development proxy, is one. A service that pairs listens on a loopback address
 * unless it is reached through a public origin, and refuses delegated access (`BEYOND_AUTHORITY`), which reads
 * `Authorization: Bearer` too.
 */
export class Portable {
	#pairing;
	#exports;
	#interface;
	#hosts;
	#public;
	#bind;
	#server;

	/**
	 * @param {{root: string, bind?: string, credential: string, pairing: true | {origins?: string[], embeds?: string[],
	 * public?: string}, interface?: string}} settings The settings of the host: the root, the address it listens on, its
	 * local credential, the pairing setting (the configured interface and embed origins, and the public origin of an
	 * external server, where `{port}` stands for the port of each listener) and the interface build
	 * @param {{hosts: import('./hosts.mjs').Hosts, events: import('./events.mjs').Events, session: () => Promise<object>,
	 * announce?: (type: string, data: object) => void, environment?: object}} context
	 * @throws {Error} For settings that cannot be served, which fails the start of the service
	 */
	constructor(settings, { hosts, events, session, announce, environment = process.env }) {
		if (environment.BEYOND_AUTHORITY) throw new Error('A service that pairs browsers cannot also verify delegated grants (BEYOND_AUTHORITY)');
		if (!settings.credential) throw new Error('A service that pairs browsers needs its local credential');
		this.#hosts = hosts;
		this.#bind = settings.bind ?? '127.0.0.1';
		this.#public = Portable.public(settings.pairing === true ? void 0 : settings.pairing?.public);
		if (!Hosts.loopback(this.#bind) && !this.#public) {
			throw new Error(`A service that pairs browsers listens on a loopback address unless it is given its public origin, and it was asked to listen on ${this.#bind}`);
		}
		this.#pairing = new Pairing(settings.pairing, { hosts, session, credential: settings.credential, environment, announce });
		this.#exports = new Exports(settings.root, { events, environment });
		this.#interface = settings.interface ? new Interface(settings.interface) : void 0;
	}

	/**
	 * A public origin as the setting gives it: an https origin, where `{port}` may stand for the port of a listener
	 *
	 * @param {unknown} value
	 * @returns {string | undefined}
	 */
	static public(value) {
		if (value === undefined || value === null || value === '') return;
		let url;
		try {
			url = new URL(String(value).replace('{port}', '1'));
		} catch {
			throw new Error(`The public origin "${value}" is not an origin`);
		}
		if (url.protocol !== 'https:' || url.pathname !== '/' || url.search || url.hash || url.username || url.password) {
			throw new Error(`The public origin "${value}" is not an https origin`);
		}
		return String(value).replace(/\/$/, '');
	}

	/**
	 * What `/session` lists for these features
	 */
	get capabilities() {
		return { ...this.#pairing.capabilities, ...this.#exports.capabilities, ...(this.#interface?.capabilities ?? {}) };
	}

	/**
	 * The cross-origin rules and the access policy, before every route of the service and after its `Host` check
	 *
	 * @param {import('express').Application} app
	 */
	guard(app) {
		this.#pairing.guard(app);
	}

	/**
	 * The routes of pairing, exports and the interface, before the compiled-module routes
	 *
	 * @param {import('express').Application} app
	 */
	setup(app) {
		this.#pairing.setup(app);
		this.#interface?.setup(app);
		new ExportRoutes(this.#exports).setup(app);
	}

	/**
	 * Recovers and sweeps the exports
	 */
	start() {
		return this.#exports.start();
	}

	/**
	 * The API listener listens: the preview listener opens on a port of its own, on the same address, and the origins
	 * of both are known
	 *
	 * @param {import('express').Application} app
	 * @param {{port: number, address: string}} api The port of the API listener, and the address local clients reach
	 * the service at
	 * @returns {Promise<{preview: string, port: number, publics: {api?: string, preview?: string}}>} The preview origin a
	 * browser uses (its public one behind a forwarder), the port of the preview listener and the public origins of both
	 * listeners
	 */
	async listen(app, { port, address }) {
		this.#server = createServer(app);
		this.#server.listen(0, this.#bind);
		await new Promise((resolve, reject) => {
			this.#server.once('listening', resolve);
			this.#server.once('error', reject);
		});
		const preview = this.#server.address().port;
		const template = this.#public?.includes('{port}');
		const publics = {
			api: this.#public?.replace('{port}', String(port)),
			preview: template ? this.#public.replace('{port}', String(preview)) : void 0
		};
		this.#hosts.expose(port, publics.api);
		this.#hosts.expose(preview, publics.preview);
		this.#pairing.listen({ api: port, preview, publics });
		return { preview: publics.preview ?? `http://${address}:${preview}`, port: preview, publics };
	}

	/**
	 * The service stops: the preview listener closes, transfers end where they are, and every pairing ends
	 */
	async stop() {
		this.#exports.stop();
		this.#pairing.close();
		if (!this.#server?.listening) return;
		this.#server.closeAllConnections();
		await new Promise(resolve => this.#server.close(resolve));
	}
}
