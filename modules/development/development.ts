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

/**
 * The events of the hosting service, which this module appends to its event log so that a client follows them on
 * `GET /events` in order with its own: `export.changed` of the source exports of a service that pairs browsers
 */
export /*bundle*/ interface IHostEvents {
	subscribe(listener: (type: string, data: Record<string, unknown>) => void): () => void;
}

/**
 * What the hosting service gives an extension
 */
export /*bundle*/ interface IHostContext {
	delivery: IBuildable;
	events?: IHostEvents;
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

	#routes: Routes;
	#previews: PreviewRoutes;
	#events?: IHostEvents;
	#unsubscribe?: () => void;

	constructor({ delivery, settings, events }: IHostContext, access = Access.from(process.env)) {
		this.#events = events;
		this.#access = access;
		this.#files = new Files(settings.root);
		this.#builds = new Builds(delivery, this.#files, settings.conditions);
		this.#selection = new Selection(settings.root, delivery, this.#files.log);
		this.#preview = new Preview(delivery, this.#selection, settings.runtime?.base);
		this.#declarations = new Declarations(delivery, this.#files);
		this.#routes = new Routes(this.#files, this.#builds, access, this.#declarations);
		this.#previews = new PreviewRoutes(this.#selection, this.#preview, access);
	}

	guard(app: Application) {
		new Guard(this.#access).setup(app);
	}

	async setup(app: Application) {
		await this.#files.start();
		this.#builds.watch();
		this.#unsubscribe = this.#events?.subscribe((type, data) => void this.#files.log.append(type, data));
		// Mounted first: the routes of the contract end with the handler that answers the refusals of both
		this.#previews.setup(app);
		this.#routes.setup(app);
	}

	stop() {
		this.#unsubscribe?.();
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
