import type { Application } from 'express';
import { Files } from './files';
import { Builds, type IBuildable } from './builds';
import { Access } from './access';
import { Selection } from './selection';
import { Preview } from './preview';
import { Declarations } from './declarations';
import { Routes } from './http/routes';
import { PreviewRoutes } from './http/preview';
import { Guard } from './http/guard';
import { Applications } from './applications';
import { Types } from './types';

/**
 * The events of the hosting service, which this module appends to its event log so that a client follows them on
 * `GET /events` in order with its own: `export.changed` of the source exports of a service that pairs browsers. The
 * transient ones (`Development.TRANSIENT`) are delivered to the open subscribers without being kept (`Log.notify`).
 */
export /*bundle*/ interface IHostEvents {
	subscribe(listener: (type: string, data: Record<string, unknown>) => void): () => void;
}

/**
 * The registry of the objects an extension shares with the features of the hosting service (`Features`): a feature
 * that writes a source reaches `files`, one that resolves an execution target reaches `applications`
 */
export /*bundle*/ interface IHostServices {
	set(name: string, service: unknown): void;
	get(name: string): any;
}

/**
 * What the hosting service gives an extension
 */
export /*bundle*/ interface IHostContext {
	delivery: IBuildable;
	events?: IHostEvents;
	services?: IHostServices;
	settings: {
		root: string;
		conditions?: { platform: string };

		/**
		 * Where the runtime that the artifacts import is installed, as the session of the service describes it
		 */
		runtime?: { base?: string };
	};
}

/**
 * The development service of one served root: source operations, events, builds and delegated access,
 * mounted on the HTTP application of the service that hosts Packages.
 */
export /*bundle*/ class Development {
	/**
	 * The events of the hosting service that are delivered and never kept, each announced at most four times a second
	 * per launch or operation: `launch.output`, which a client recovers with `GET /launches/:id/output?after=` after it
	 * reconnects, and `operation.progress`, the counts and current item of a running operation, which it recovers with
	 * `GET /operations/:id`. Stored, they would push the source events out of the log's retention and force every
	 * build to be superseded.
	 */
	static TRANSIENT = new Set(['launch.output', 'operation.progress']);

	#files: Files;
	get files() {
		return this.#files;
	}

	#builds: Builds;
	get builds() {
		return this.#builds;
	}

	#access: Access;
	get access() {
		return this.#access;
	}

	#selection: Selection;
	get selection() {
		return this.#selection;
	}

	#preview: Preview;
	get preview() {
		return this.#preview;
	}

	#declarations: Declarations;
	get declarations() {
		return this.#declarations;
	}

	#applications: Applications;
	get applications() {
		return this.#applications;
	}

	#types: Types;

	#routes: Routes;
	#previews: PreviewRoutes;
	#events?: IHostEvents;
	#services?: IHostServices;
	#unsubscribe?: () => void;

	constructor({ delivery, settings, events, services }: IHostContext, access = Access.from(process.env)) {
		this.#events = events;
		this.#services = services;
		this.#access = access;
		this.#files = new Files(settings.root);
		this.#builds = new Builds(delivery, this.#files, settings.conditions);
		this.#selection = new Selection(settings.root, delivery, this.#files.log);
		this.#preview = new Preview(delivery, this.#selection, settings.runtime?.base);
		this.#declarations = new Declarations(delivery, this.#files);
		const selection = this.#selection;
		this.#applications = new Applications({ root: settings.root, files: this.#files, delivery, preview: this.#preview, selection, access });
		this.#types = new Types({ delivery, files: this.#files, access });
		this.#routes = new Routes(this.#files, this.#builds, access, this.#declarations);
		this.#previews = new PreviewRoutes(this.#selection, this.#preview, access);
	}

	guard(app: Application) {
		new Guard(this.#access).setup(app);
	}

	async setup(app: Application) {
		await this.#files.start();
		this.#builds.watch();
		const log = this.#files.log;
		this.#unsubscribe = this.#events?.subscribe((type, data) => void (Development.TRANSIENT.has(type) ? log.notify(type, data) : log.append(type, data)));

		// What the features of the host use: the source operations with their revisions and event log, the selection
		// and the preview, so they never write a source or resolve an entry around this extension
		await this.#applications.start();
		const shared: [string, unknown][] = [
			['files', this.#files],
			['log', this.#files.log],
			['selection', this.#selection],
			['preview', this.#preview],
			['declarations', this.#declarations],
			['builds', this.#builds],
			['applications', this.#applications]
		];
		shared.forEach(([name, service]) => this.#services?.set(name, service));
		// Mounted first: the routes of the contract end with the handler that answers the refusals of all of them
		this.#previews.setup(app);
		this.#applications.setup(app);
		this.#types.setup(app);
		this.#routes.setup(app);
	}

	stop() {
		this.#unsubscribe?.();
		this.#applications.destroy();
		this.#routes.stream.close();
		this.#builds.stop();
		this.#files.stop();
	}
}

let instance: Development;
const development = (context: IHostContext) => (instance ??= new Development(context));

/**
 * Extension entry of the hosting service, called before its own routes are mounted
 */
export /*bundle*/ function guard(app: Application, context: IHostContext) {
	development(context).guard(app);
}

/**
 * Extension entry of the hosting service, called after its own routes and before its error handler
 */
export /*bundle*/ async function setup(app: Application, context: IHostContext) {
	await development(context).setup(app);
	process.once('beforeExit', () => instance?.stop());
}
