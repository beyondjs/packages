import { ProductionError } from '../error.mjs';

/**
 * The execution target a web export builds, resolved by the catalog of applications that the development extension
 * shares (`services.get('applications')`, `beyond-applications/1`): its kind, its entry module and its execution
 * environment. Only a `frontend` target, which a browser document loads, has a web export.
 *
 * A service whose catalog cannot resolve targets (one whose development extension predates `beyond-applications/1`)
 * has no source for one, which is `APPLICATIONS_UNAVAILABLE`, unless the request names its entry (a public specifier):
 * that stand-in exists for the validations of a Core without the catalog, and the export then says, in its result and
 * its manifest, that its entry came from the request (`EXPORT_ENTRY_FROM_REQUEST`). The command line never sends one.
 *
 * ```js
 * const target = await new Target(services).resolve({ application: 'site', target: 'web' });
 * // {application, target, kind, entry: {specifier, vspecifier?}, environment, source: 'catalog', diagnostics}
 * ```
 */
export class Target {
	static #APPLICATION = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
	static #TARGET = /^[a-z][a-z0-9-]{0,31}$/;

	#services;

	/**
	 * @param {{get(name: string): any}} services The objects the development extension shares
	 */
	constructor(services) {
		this.#services = services;
	}

	/**
	 * Checks the identifiers of a request, as the application model writes them
	 *
	 * @throws {ProductionError} `REQUEST_INVALID`
	 */
	static check({ application, target }) {
		if (typeof application !== 'string' || !Target.#APPLICATION.test(application)) throw new ProductionError('REQUEST_INVALID', '"application" is the identifier of a declared application');
		if (typeof target !== 'string' || !Target.#TARGET.test(target)) throw new ProductionError('REQUEST_INVALID', '"target" is the identifier of an execution target of that application');
	}

	/**
	 * @param {{application: string, target: string, entry?: unknown}} request
	 * @returns {Promise<{application: string, target: string, kind: string, entry: {specifier: string, vspecifier?:
	 * string}, environment: string, source: 'catalog' | 'request', diagnostics: object[]}>}
	 * @throws {ProductionError} `APPLICATIONS_UNAVAILABLE`, `APPLICATION_NOT_FOUND`, `TARGET_NOT_FOUND`,
	 * `TARGET_NOT_FRONTEND`, `TARGET_UNRESOLVED`
	 */
	async resolve(request) {
		Target.check(request);
		const { application, target } = request;
		const catalog = this.#services.get('applications');
		if (typeof catalog?.resolve !== 'function') return this.#requested(request);

		let resolved;
		try {
			resolved = await catalog.resolve(application, target);
		} catch (error) {
			const code = ['APPLICATION_NOT_FOUND', 'TARGET_NOT_FOUND'].includes(error?.code) ? error.code : 'TARGET_UNRESOLVED';
			// A refusal of the development contract carries its details in its body
			const diagnostics = error?.details?.diagnostics ?? error?.body?.error?.diagnostics;
			throw new ProductionError(code, error?.message ?? String(error), diagnostics ? { diagnostics } : void 0);
		}
		if (!resolved) throw new ProductionError('TARGET_NOT_FOUND', `The application "${application}" declares no target "${target}"`);

		const kind = resolved.kind ?? resolved.declared?.kind;
		const diagnostics = (resolved.diagnostics ?? []).filter(Boolean);
		if (kind !== 'frontend') {
			throw new ProductionError('TARGET_NOT_FRONTEND', `"${application}/${target}" is a ${kind ?? 'target without a kind'}: only a frontend target, which a browser document loads, has a web export`);
		}
		// A declaration error of the target (its package or entry not found, no output for a browser) prevents the export
		const errors = diagnostics.filter(({ severity }) => severity === 'error');
		const specifier = resolved.entry?.specifier;
		if (errors.length || typeof specifier !== 'string' || !specifier) {
			const message = errors[0]?.message ?? `The entry of "${application}/${target}" could not be resolved`;
			throw new ProductionError('TARGET_UNRESOLVED', message, { diagnostics });
		}
		const vspecifier = resolved.entry?.vspecifier;
		const named = resolved.declared?.title ?? resolved.application?.title;
		const title = typeof named === 'string' ? { title: named } : {};
		return { application, target, ...title, kind, entry: { specifier, ...(vspecifier ? { vspecifier } : {}) }, environment: resolved.environment ?? 'browser', source: 'catalog', diagnostics };
	}

	/**
	 * The entry the request names, when the catalog cannot resolve targets
	 */
	#requested({ application, target, entry }) {
		if (entry === undefined) {
			throw new ProductionError('APPLICATIONS_UNAVAILABLE', 'This service cannot resolve execution targets: its catalog of applications is not available (update the development service)');
		}
		if (typeof entry !== 'string' || !/^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*(\/[^\s]+)?$/i.test(entry)) {
			throw new ProductionError('REQUEST_INVALID', '"entry" is the public specifier of the entry module');
		}
		const diagnostics = [{ code: 'EXPORT_ENTRY_FROM_REQUEST', severity: 'warning', message: 'The entry was named by the request, not resolved from a declared target' }];
		return { application, target, kind: 'frontend', entry: { specifier: entry }, environment: 'browser', source: 'request', diagnostics };
	}
}
