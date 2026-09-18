/**
 * The host of one development service: the process where Packages runs.
 *
 * It imports the public modules of Packages (`@beyond-js/packages/...`) and nothing tells it where they come
 * from: in a compiled distribution Node resolves them, and in one that carries sources the supervisor starts
 * this process with the loader and the environment that the bootstrap prepared. The workspace it serves is
 * compiled by Packages in either case, never by Engine.
 *
 * Readiness means the service can be used: the watchers service runs, the workspace was read and the HTTP
 * endpoint listens. It does not mean the workspace builds; a workspace with source errors is served so that
 * they can be seen and corrected, and only executing a module requires its graph to be valid.
 */
import { writeSync } from 'node:fs';
import express from 'express';
import { Routes } from '@beyond-js/packages/http/routes';
import { WatchersService } from '@beyond-js/packages/watchers';
import { Session } from '@beyond-js/artifact-api';
import { Attachments } from './attachments.mjs';
import { Description } from './description.mjs';
import { Extensions } from './extensions.mjs';
import { Graph } from './graph.mjs';
import { Hosted } from './hosted.mjs';
import { Lifetime } from './lifetime.mjs';
import { Processors } from './processors.mjs';

const settings = JSON.parse(process.env.BEYOND_HOST_OPTIONS);
const log = (...values) => console.log(new Date().toISOString(), ...values);

/**
 * Reports the outcome of the start to the supervisor through the pipe it opened as fd 3. This process has
 * no IPC channel on purpose: see the supervisor.
 */
const report = message => {
	try {
		writeSync(3, `${JSON.stringify(message)}\n`);
	} catch {
		// Started by hand, without a supervisor to report to
	}
};

let watchers;
let workspace;
let server;
let ending = false;



const attachments = new Attachments(settings.token);

async function end(reason, code = 0) {
	if (ending) return;
	ending = true;
	log(`stopping: ${reason}`);

	// A step that hangs does not keep the service alive
	setTimeout(() => process.exit(code), 6000).unref();

	attachments.close(reason);
	server?.closeAllConnections?.();
	await new Promise(resolve => (server ? server.close(resolve) : resolve()));

	// The order the Packages validation establishes: the watchers service first, then its clients. The
	// clients release their watchers asynchronously and nothing awaits them, so destroying the workspace
	// first races with the service that is closing; what fails while stopping is logged, not fatal.
	await watchers?.stop().catch(error => log(`watchers: ${error.message}`));
	try {
		workspace?.destroy();
	} catch (error) {
		log(`workspace: ${error.message}`);
	}
	process.exit(code);
}

Processors.contain(log, () => ending, reason => end(reason, 1));

['SIGTERM', 'SIGINT', 'SIGHUP'].forEach(signal => process.on(signal, () => end(`signal ${signal}`)));
// The supervisor holds the other end of stdin and never writes to it: its end is the end of the supervisor
process.stdin.on('end', () => end('the supervisor ended')).on('error', () => {});
process.stdin.resume();

try {
	// The watchers service is a child of this process, started as the preparation of the implementation says
	watchers = new WatchersService('watchers', {
		env: { ...settings.watchers.env, BEYOND_HOST_OPTIONS: '' },
		cwd: settings.watchers.cwd
	});
	await watchers.start();

	// What the routes deliver: the Packages workspace of the root, reloaded when its manifests change
	workspace = new Hosted(settings, log);
	await workspace.ready;

	const delivery = workspace;
	const description = new Description(settings, delivery);
	const graph = new Graph(delivery, description.conditions);

	const extensions = new Extensions(settings.extensions);
	await extensions.load();

	const app = express();
	app.disable('x-powered-by');
	await extensions.guard(app, { workspace, settings });
	Routes.setup(app, delivery);
	attachments.setup(app);

	// Whoever resolves or describes the workspace sees the declarations as they are now
	app.get([Session.PATH, '/state', '/selection'], (request, response, next) => workspace.refresh().then(() => next(), next));

	app.get(Session.PATH, async (request, response, next) => description.session().then(value => response.json(value), next));
	app.get('/state', async (request, response, next) =>
		description.state().then(value => response.json({ ...value, attachments: attachments.list }), next)
	);

	/**
	 * Resolves a selector to a public module and checks that everything it reaches builds, which is what
	 * executing it requires
	 */
	app.get('/selection', async (request, response, next) => {
		try {
			const { selector, directory } = request.query;
			const { selected, errors } = await delivery.selection.resolve(String(selector ?? ''), directory && String(directory));
			if (!selected) return response.status(404).json({ error: { ...errors[0], diagnostics: errors } });

			const { specifier, vspecifier, subpath } = selected;
			const { name, version } = selected.package;
			const checked = await graph.check({ name, version, subpath, vspecifier });
			response.json({ selected: { specifier, vspecifier, name, version, subpath }, ...checked });
		} catch (error) {
			next(error);
		}
	});

	await extensions.setup(app, { workspace, settings });
	Routes.errors(app);

	/**
	 * The service has no authentication: whoever reaches it reads the compiled sources and can attach to it.
	 * It listens on the loopback address unless the caller names another one, which is only appropriate
	 * where something else controls who reaches it, such as the network of a container behind a gateway.
	 */
	const bind = settings.bind ?? '127.0.0.1';
	const loopback = ['127.0.0.1', '::1', 'localhost'].includes(bind);
	!loopback && log(`warning: listening on ${bind} without authentication; access must be controlled outside this service`);

	server = app.listen(settings.port ?? 0, bind);
	await new Promise((resolve, reject) => {
		server.once('listening', resolve);
		server.once('error', error =>
			reject(error.code === 'EADDRINUSE' ? new Error(`Port ${settings.port} is already in use`) : error)
		);
	});

	// Local clients reach a wildcard address through the loopback one
	const wildcard = ['0.0.0.0', '::'].includes(bind);
	const address = loopback || wildcard ? '127.0.0.1' : bind.includes(':') ? `[${bind}]` : bind;
	const origin = `http://${address}:${server.address().port}`;
	description.origin = origin;

	new Lifetime(settings.lifetime, attachments, reason => end(reason)).start();
	log(`ready: ${origin} serving ${settings.root}`);
	report({ ready: { origin } });
} catch (error) {
	log(`failed: ${error.stack}`);
	report({ failed: error.message });
	await end('startup failure', 1);
}
