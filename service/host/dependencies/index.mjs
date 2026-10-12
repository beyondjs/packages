import { Modules } from './modules.mjs';
import { Host } from './host.mjs';
import { PlanStore } from './store.mjs';
import { Checks } from './checks.mjs';
import { Preflight } from './preflight.mjs';
import { Plans } from './plans.mjs';
import { Applying } from './apply.mjs';
import { DependencyRoutes } from './routes.mjs';

/**
 * Dependency management (`beyond-dependencies/1`), a feature of the host over the installation of Packages
 * (`@beyond-js/packages/installation`) and its resolver: the inventory of the graph, checks of the versions the
 * configured registries publish, the preflight of an installation, plans of explicit changes and their application,
 * each long one an operation of the host (`beyond-dev-operations/1`). It never runs a package manager, never installs
 * part of a graph and never resolves outside the installation's own resolver, providers, metadata cache and bounds.
 *
 * It works through the File API of the development extension, which writes manifests with their revisions: without
 * it the routes answer as unmounted and no capability is claimed. Plans are kept in `.beyond/dependencies/plans`; an
 * application the service stopped is reconciled with the workspace when it starts again, never one that another live
 * host on the same root runs (`Owner`). See the guide `docs/dependencies.md`.
 */
export class Feature {
	static NAME = 'dependencies';

	#context;
	#host;
	#store;
	#applying;
	#routes;

	/**
	 * @param {{root: string, settings: object, workspace: object, operations: object, services: object, log?:
	 * Function, environment?: object}} context What the host gives every feature
	 * @param {Modules} [modules] The classes of Packages it uses; stand-ins in a test
	 */
	constructor(context, modules = new Modules()) {
		this.#context = context;
		this.#host = new Host(context, modules);
		this.#store = new PlanStore(context.root);
		this.#applying = new Applying(this.#host, this.#store, context.operations?.owner);
		this.#routes = new DependencyRoutes({
			host: this.#host,
			operations: context.operations,
			store: this.#store,
			checks: new Checks(this.#host),
			preflight: new Preflight(this.#host),
			plans: new Plans(this.#host, this.#store),
			applying: this.#applying
		});
	}

	/**
	 * Removes expired plans, and reconciles each application the service stopped while it ran with what the workspace
	 * holds now: the operations registry interrupted it because its host is gone; a failure is logged and never fails
	 * the start of the service
	 */
	async start() {
		await this.#store.sweep().catch(() => void 0);
		try {
			const records = await this.#context.operations?.list?.({ kind: Applying.KIND, limit: 50 });
			for (const record of (records ?? []).filter(one => one.state === 'interrupted' && one.scope?.plan)) {
				await this.#applying.reconcile(record);
			}
		} catch (error) {
			this.#context.log?.(`dependencies: an interrupted application was not reconciled: ${error?.message ?? error}`);
		}
	}

	/**
	 * @param {import('express').Application} app
	 */
	setup(app) {
		this.#routes.setup(app);
	}

	/**
	 * `dependencies: 1` once the development extension shares its File API, read after every extension is set up
	 */
	get capabilities() {
		return this.#host.files ? { dependencies: 1 } : {};
	}
}
