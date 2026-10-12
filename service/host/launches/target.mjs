import { LaunchError } from './error.mjs';

/**
 * An execution target as a launch needs it: the specifier its entry is imported by, the environment it runs in (`node`
 * or `deno`) and the readiness text it declares. It is established by the catalog of applications of the development
 * extension (`services.get('applications').resolve(application, target)`, `beyond-applications/1`): this feature
 * resolves no entry and reads no declaration of its own.
 *
 * The specifier is the one the catalog says a launch imports (`launch.specifier`): the public specifier of the entry,
 * or the versioned one it resolved (`entry.vspecifier`) when several local versions of the package publish it, which
 * is how the session of the service names it, so the version the target selects is the one that runs.
 *
 * ```js
 * const target = await Target.resolve(services.get('applications'), 'composition', 'api');
 * target.specifier;     // '@testbed/composition-api/server'
 * target.environment;   // 'node'
 * target.readiness;     // 'composition API listening'
 * ```
 */
export class Target {
	static #RUNTIME = /^(node|deno)(?![a-z0-9_-])/;

	#application;
	#target;
	#specifier;
	#environment;
	#readiness;

	/**
	 * @param {{application: string, target: string, specifier: string, environment: 'node' | 'deno', readiness?: string}} values
	 */
	constructor({ application, target, specifier, environment, readiness }) {
		this.#application = application;
		this.#target = target;
		this.#specifier = specifier;
		this.#environment = environment;
		this.#readiness = readiness;
	}

	get application() {
		return this.#application;
	}

	get target() {
		return this.#target;
	}

	get specifier() {
		return this.#specifier;
	}

	get environment() {
		return this.#environment;
	}

	/**
	 * The text whose appearance in the output makes the process ready, undefined when none is declared
	 */
	get readiness() {
		return this.#readiness;
	}

	/**
	 * Resolves a declared target through the catalog and establishes whether it can be launched
	 *
	 * @param {{resolve?: (application: string, target: string) => Promise<object>} | undefined} catalog
	 * @param {string} application
	 * @param {string} target
	 * @returns {Promise<Target>}
	 * @throws {LaunchError} `APPLICATION_NOT_FOUND`, `TARGET_NOT_FOUND`; `TARGET_NOT_LAUNCHABLE` with the reason:
	 * `APPLICATIONS_UNAVAILABLE` (no catalog on this service), `TARGET_FRONTEND`, `TARGET_KIND_INVALID`, the reason the
	 * catalog gives (`launch.supported: false`), `TARGET_ENTRY_NOT_FOUND`, `TARGET_RUNTIME_UNSUPPORTED`; `UNAVAILABLE`
	 * when the catalog cannot answer now
	 */
	static async resolve(catalog, application, target) {
		if (typeof catalog?.resolve !== 'function') {
			const message = 'This development service has no catalog of applications: it is part of the development extension (@beyond-js/packages/development)';
			throw LaunchError.unlaunchable('APPLICATIONS_UNAVAILABLE', message);
		}

		let resolved;
		try {
			resolved = await catalog.resolve(application, target);
		} catch (error) {
			if (['APPLICATION_NOT_FOUND', 'TARGET_NOT_FOUND'].includes(error?.code)) throw new LaunchError(error.code, error.message);
			if (error?.code === 'UNAVAILABLE' || error?.status === 503) throw new LaunchError('UNAVAILABLE', error.message);
			throw error;
		}
		return Target.of(application, target, resolved ?? {});
	}

	/**
	 * The launchable target of a resolved one
	 *
	 * @param {string} application
	 * @param {string} target
	 * @param {object} resolved What the catalog answered: the declared fields (under `declared`, or at the top level),
	 * the entry (`entry.specifier`), the environment and how it starts (`launch: {supported, reason?}`)
	 * @returns {Target}
	 */
	static of(application, target, resolved) {
		const declared = resolved.declared ?? resolved;
		const name = `"${application}/${target}"`;
		const kind = declared.kind ?? resolved.kind;
		if (kind === 'frontend') {
			throw LaunchError.unlaunchable('TARGET_FRONTEND', `${name} is a frontend target: it is opened as a document (its preview), not launched`);
		}
		if (kind !== 'backend') throw LaunchError.unlaunchable('TARGET_KIND_INVALID', `${name} declares no valid kind, so it cannot be launched`);

		const launch = resolved.launch ?? {};
		if (launch.supported === false) {
			const reason = typeof launch.reason === 'string' ? launch.reason : launch.reason?.code ?? 'TARGET_NOT_LAUNCHABLE';
			const said = typeof launch.reason === 'object' && launch.reason?.message ? `: ${launch.reason.message}` : ` (${reason})`;
			throw LaunchError.unlaunchable(reason, `${name} cannot be launched${said}`);
		}

		// The catalog names what a launch imports; one that predates it names the entry's public specifier only
		const specifier = launch.specifier ?? resolved.entry?.specifier ?? resolved.specifier;
		if (typeof specifier !== 'string' || !specifier) {
			throw LaunchError.unlaunchable('TARGET_ENTRY_NOT_FOUND', `The entry of ${name} was not found in the workspace, so it cannot be launched`);
		}

		// The declared runtime decides, `node` when none is declared; the environment of the catalog follows from it
		const runtime = String(declared.runtime ?? resolved.runtime ?? (resolved.environment === 'deno' ? 'deno' : 'node'));
		const environment = Target.#RUNTIME.exec(runtime)?.[1];
		if (!environment) throw LaunchError.unlaunchable('TARGET_RUNTIME_UNSUPPORTED', `${name} runs in "${runtime}", which this service cannot launch: it launches node and deno`);

		const output = declared.readiness?.output;
		const readiness = typeof output === 'string' && output ? output : void 0;
		return new Target({ application, target, specifier, environment, readiness });
	}
}
