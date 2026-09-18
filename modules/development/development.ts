import type { Application } from 'express';
import { Files } from './files';
import { Builds, type IBuildable } from './builds';
import { Access } from './access';
import { Routes } from './http/routes';
import { Guard } from './http/guard';

/**
 * What the hosting service gives an extension
 */
export /*bundle*/ interface IHostContext {
	delivery: IBuildable;
	settings: { root: string; conditions?: object };
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

	#routes: Routes;

	constructor({ delivery, settings }: IHostContext, access = Access.from(process.env)) {
		this.#access = access;
		this.#files = new Files(settings.root);
		this.#builds = new Builds(delivery, this.#files.log, settings.conditions);
		this.#routes = new Routes(this.#files, this.#builds, access);
	}

	guard(app: Application) {
		new Guard(this.#access).setup(app);
	}

	async setup(app: Application) {
		await this.#files.start();
		this.#builds.watch();
		this.#routes.setup(app);
	}

	stop() {
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
