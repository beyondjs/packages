import { DependencyError } from './error.mjs';
import { Snapshot } from './snapshot.mjs';
import { Plans } from './plans.mjs';
import { ManifestWrites } from './writes.mjs';
import { Phases } from './phases.mjs';

/**
 * The application of an accepted plan (`POST /dependencies/plans/:plan/apply`, operation `dependencies.apply`), one at
 * a time per service and not cancellable: once it writes, stopping half way would leave the workspace in a state
 * nobody chose.
 *
 * - `verify`: the workspace is read again. Still at the plan's base, the plan is applied; already at its proposed lock
 *   and inputs (an earlier application whose answer was lost), nothing is repeated; with the plan's manifests written
 *   and another lock (an application that stopped after its writes), the installation is run again; anything else is
 *   `PLAN_STALE`.
 * - `write`: the manifest edits, through the File API with the revisions they were read at (`MANIFEST_CONFLICT`).
 * - `resolve`, `fetch`, `materialize`: the installation of the edited workspace with the plan's preferences, never
 *   with `update`, which writes the lock and the projection as every installation does; a failed one writes neither
 *   and fails with its own code (`GRAPH_INCOMPLETE`, `SOURCES_INCOMPLETE`, …), naming the manifests already written.
 * - `reload`: the served workspace is reloaded; one that does not settle is a warning, and the next request reloads.
 *
 * Each application is recorded on its plan (`application: {operation, state, …}`): `running` with the host that runs it
 * when it begins, then how it ended. One the service stopped is reconciled by reading the workspace (`reconcile`) before
 * anything is repeated, and only by a host that finds the one that ran it gone: an application another live host runs
 * on the same root, and one a later application of the plan replaced, are left as they are.
 */
export class Applying {
	static KIND = 'dependencies.apply';
	static STEPS = Object.freeze([
		{ id: 'verify', expected: { median: 100, p90: 500 } },
		{ id: 'write', expected: { median: 200, p90: 1000 } },
		{ id: 'resolve', expected: { median: 8000, p90: 30000 } },
		{ id: 'fetch', expected: { median: 10000, p90: 60000 } },
		{ id: 'materialize', expected: { median: 1000, p90: 5000 } },
		{ id: 'reload', expected: { median: 3000, p90: 20000 } }
	]);

	#host;
	#store;
	#owner;
	#last = Promise.resolve();

	/**
	 * @param {import('./host.mjs').Host} host
	 * @param {import('./store.mjs').PlanStore} store
	 * @param {import('../operations/owner.mjs').Owner} [owner] This host, which decides whether the host that recorded an
	 * application is gone
	 */
	constructor(host, store, owner) {
		this.#host = host;
		this.#store = store;
		this.#owner = owner;
	}

	/**
	 * Where the workspace is with respect to a plan: `applied` (its lock and inputs are the proposed ones), `base`
	 * (those the plan was made against), `written` (the plan's manifests are written, its lock is not there yet) or
	 * `diverged`
	 *
	 * @param {import('./snapshot.mjs').Snapshot} snapshot
	 * @param {{base: object, proposed: {lock: string | null, inputs: string}, edits: object[]}} plan
	 */
	static state(snapshot, { base, proposed, edits }) {
		if (snapshot.lock.digest && snapshot.lock.digest === proposed.lock && snapshot.inputs === proposed.inputs) return 'applied';
		if (Snapshot.same(snapshot.base, base)) return 'base';
		if (edits.length && snapshot.inputs === proposed.inputs) return 'written';
		return 'diverged';
	}

	/**
	 * The work of an application, after the ones before it ended
	 *
	 * @param {import('../operations/operation.mjs').Operation} operation
	 * @param {object} plan
	 */
	run(operation, plan) {
		const run = this.#last.then(() => this.#apply(operation, plan));
		this.#last = run.catch(() => void 0);
		return run;
	}

	async #apply(operation, plan) {
		const record = (state, fields = {}) =>
			this.#store.update(plan.id, { application: { operation: operation.id, state, at: new Date().toISOString(), ...fields } }).catch(() => void 0);
		await record('running', operation.owner ? { owner: operation.owner.toJSON() } : {});
		try {
			const result = await this.#steps(operation, plan);
			await record('applied', { lock: result.lock?.digest ?? null });
			return result;
		} catch (error) {
			await record('failed', { code: error?.code ?? 'OPERATION_FAILED' });
			throw error;
		}
	}

	async #steps(operation, plan) {
		const verify = operation.step('verify').begin({ phase: 'verify' });
		const snapshot = await this.#host.snapshot();
		const state = Applying.state(snapshot, plan);
		if (state === 'diverged') throw Plans.stale(plan.base, snapshot.base);
		verify.done();

		let written = [];
		let report;
		if (state === 'applied') {
			['write', 'resolve', 'fetch', 'materialize'].forEach(id => operation.step(id).skip());
		} else {
			if (state === 'base' && plan.edits.length) written = await this.#write(operation, plan);
			else operation.step('write').skip();
			report = await this.#install(operation, plan, written);
		}

		const reloading = operation.step('reload').begin({ phase: 'reload' });
		const warnings = [];
		let reloaded = false;
		try {
			await this.#host.hosted?.reload?.();
			reloading.done();
			reloaded = true;
		} catch (error) {
			const message = `The installation was written, and the service did not reload the workspace yet: ${error?.message ?? error}. The next request that describes the workspace reloads it`;
			reloading.fail({ code: error?.code ?? 'UNAVAILABLE', message });
			warnings.push({ code: error?.code ?? 'UNAVAILABLE', message, severity: 'warning' });
		}
		const digest = report?.lock?.digest ?? snapshot.lock.digest;
		if (digest !== plan.proposed.lock) {
			const message = `The installed lock (${digest}) is not the one the plan proposed (${plan.proposed.lock}): what a registry publishes changed since the plan was made`;
			warnings.push({ code: 'PLAN_DIVERGED', message, severity: 'warning' });
		}
		return {
			protocol: 'beyond-dependencies/1',
			plan: plan.id,
			applied: true,
			reconciled: state === 'applied',
			found: state,
			written,
			lock: report?.lock ?? { digest, written: false },
			execution: report?.execution ?? { written: false },
			counts: report?.counts ?? null,
			reloaded,
			diagnostics: [...(report?.diagnostics ?? []), ...warnings]
		};
	}

	async #write(operation, plan) {
		const files = this.#host.files;
		if (!files) throw new DependencyError('MANIFEST_CONFLICT', 'The File API is not available: no manifest was written', { written: [] });
		const actor = { sub: 'dependencies', kind: 'service', task: plan.id };
		return await new ManifestWrites(files, plan.edits, actor).run(operation.step('write'));
	}

	/**
	 * Installs the edited workspace with the plan's preferences, its phases on the steps
	 */
	async #install(operation, plan, written) {
		const edited = await this.#host.snapshot();
		if (edited.inputs !== plan.proposed.inputs) {
			const message = 'The declared dependencies changed while the plan was applied: nothing was installed';
			throw new DependencyError('PLAN_STALE', message, { written, base: plan.proposed.inputs, current: edited.inputs });
		}
		const installation = await this.#host.installation(edited.params);
		const phases = new Phases(operation);
		const report = await installation.install({ preferences: plan.preferences, progress: event => phases.tell(event) });
		phases.end(report);
		if (report.valid) return report;

		const first = (report.diagnostics ?? []).find(({ severity }) => severity === 'error');
		const message = `${first?.message ?? 'The installation is not valid'}${written.length ? `; the manifests written stay: ${written.map(({ path }) => path).join(', ')}` : ''}`;
		throw new DependencyError(first?.code ?? 'INSTALLATION_FAILED', message, { written, lock: report.lock, execution: report.execution, diagnostics: report.diagnostics });
	}

	/**
	 * Records what the service found after it stopped while applying a plan: `applied`, `not-applied`, `partial` (the
	 * manifests were written, the lock was not) or `diverged`
	 *
	 * @param {{id: string, scope?: {plan?: string}}} interrupted The record of the interrupted operation
	 */
	async reconcile(interrupted) {
		const plan = await this.#store.read(interrupted.scope?.plan);
		const recorded = plan?.application;
		if (!plan || recorded?.reconciled === interrupted.id) return;
		// A later application replaced its record, or a live host still runs the one recorded: neither is this one's
		if (recorded?.operation && recorded.operation !== interrupted.id) return;
		if (recorded?.state === 'running' && this.#owner && !this.#owner.gone(recorded.owner)) return;
		const state = Applying.state(await this.#host.snapshot(), plan);
		const outcome = { applied: 'applied', base: 'not-applied', written: 'partial', diverged: 'diverged' }[state];
		const application = { operation: interrupted.id, state: 'interrupted', outcome, at: new Date().toISOString(), reconciled: interrupted.id };
		await this.#store.update(plan.id, { application });
	}
}
