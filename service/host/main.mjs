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
import { Execution } from '@beyond-js/packages/execution';
import { Session } from '@beyond-js/artifact-api';
import { Deadline } from '../deadline.mjs';
import { Declaration } from '../workspace/declaration.mjs';
import { Attachments } from './attachments.mjs';
import { Description } from './description.mjs';
import { Extensions } from './extensions.mjs';
import { Graph } from './graph.mjs';
import { Holds } from './holds.mjs';
import { Hosted } from './hosted.mjs';
import { Installer } from './installer.mjs';
import { Lifetime } from './lifetime.mjs';
import { Processors } from './processors.mjs';
import { InstallationRoutes } from './routes.mjs';
import { Selection } from './selection.mjs';

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

// The work that keeps the service alive while it runs, besides its attachments
const holds = new Holds();

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
	// The watchers service is a child of this process, started as the preparation of the implementation says.
	// How long its readiness is waited for is deployment configuration: on a loaded host the child loads its
	// implementation later than the default deadline, and a slow start is not a failed one
	const deadline = new Deadline('BEYOND_WATCHERS_TIMEOUT').read(process.env);
	watchers = new WatchersService('watchers', {
		env: { ...settings.watchers.env, BEYOND_HOST_OPTIONS: '' },
		cwd: settings.watchers.cwd,
		...(deadline ? { timeout: deadline } : {})
	});
	await watchers.start();

	// What the routes deliver: the Packages workspace of the root, reloaded when its manifests change. Reading
	// it is bounded, at the start and at every reload: a workspace that never becomes ready fails the start
	// instead of holding it, and a reload that never does is answered as unavailable
	const reading = new Deadline('BEYOND_WORKSPACE_TIMEOUT', 120000).read(process.env);
	workspace = new Hosted(settings, log, { deadline: reading });
	await workspace.start();

	const delivery = workspace;
	const description = new Description(settings, delivery);
	const graph = new Graph(delivery, description.conditions);

	const extensions = new Extensions(settings.extensions);
	await extensions.load();

	// The selection answers a browser module with the address of its preview, which the development extension serves
	const selection = new Selection(delivery, graph, { previews: extensions.has(Selection.DEVELOPMENT) });

	// Installing loads the installation of Packages the first time it is asked for, not at every start. A request to
	// install waits for the one before it within BEYOND_INSTALL_QUEUE_TIMEOUT, and is not started when it expires.
	// An installation that runs holds the service within its deadline (BEYOND_INSTALL_DEADLINE): a command that stops
	// waiting for it does not end the service under it
	const installation = () => import('@beyond-js/packages/installation').then(({ Installation }) => Installation);
	const queue = new Deadline('BEYOND_INSTALL_QUEUE_TIMEOUT', Installer.QUEUE).read(process.env);
	const term = new Deadline('BEYOND_INSTALL_DEADLINE', Installer.DEADLINE).read(process.env);
	const modules = { Declaration, Execution, installation };
	const installer = new Installer({ root: settings.root, hosted: workspace, modules, log, queue, deadline: term, holds });

	const app = express();
	app.disable('x-powered-by');
	await extensions.guard(app, { workspace, settings });

	// Before the routes of the compiled-module contract, whose answers any origin may read: no page of another
	// origin reads the installation of the workspace or runs one
	new InstallationRoutes(installer, { bind: settings.bind }).setup(app);
	Routes.setup(app, delivery);
	attachments.setup(app);

	// Whoever resolves or describes the workspace sees the declarations as they are now
	app.get([Session.PATH, '/state', '/selection'], (request, response, next) => workspace.refresh().then(() => next(), next));

	app.get(Session.PATH, async (request, response, next) => description.session().then(value => response.json(value), next));
	app.get('/state', async (request, response, next) =>
		description.state().then(value => response.json({ ...value, attachments: attachments.list }), next)
	);
	selection.setup(app);

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

	new Lifetime(settings.lifetime, attachments, reason => end(reason), holds).start();
	log(`ready: ${origin} serving ${settings.root}`);
	report({ ready: { origin } });
} catch (error) {
	log(`failed: ${error.stack}`);
	report({ failed: error.message });
	await end('startup failure', 1);
}
