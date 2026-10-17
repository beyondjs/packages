import { Component } from '../../component.mjs';
import { Snapshot } from './snapshot.mjs';

/**
 * What dependency management works with, from what the host gives its features: the workspace as it is on disk now
 * (`snapshot()`), installations of it (`installation(params)`, with the deadline of the service's installations), the
 * File API through which manifests are written (`files`), the served workspace that is reloaded and lists the public
 * modules (`hosted`) and the catalog of applications (`applications`). The objects of the development extension are
 * read when they are needed: the extension shares them after the features are mounted.
 */
export class Host {
	#context;
	#modules;

	/**
	 * @param {{root: string, settings: object, workspace: object, services: {get(name: string): any}, environment?:
	 * object}} context What the host gives its features
	 * @param {import('./modules.mjs').Modules} modules
	 */
	constructor(context, modules) {
		this.#context = context;
		this.#modules = modules;
	}

	get root() {
		return this.#context.root;
	}

	/**
	 * The workspace on disk now
	 *
	 * @returns {Promise<Snapshot>}
	 */
	async snapshot() {
		const Execution = await this.#modules.execution();
		const supplied = this.#context.settings?.supplied ?? [];
		return await Snapshot.read(this.#context.root, { Execution, supplied: [...supplied, ...Host.libraries(this.#context.settings?.runtime, supplied)] });
	}

	/**
	 * The libraries the toolchain supplies besides its Beyond packages, which a workspace without an installed graph
	 * resolves from the toolchain's installation: the packages of the session's runtime (the Kernel, and the frameworks
	 * the supplied packages depend on, such as React), each `{name, path, library: true}`; one that is not installed is
	 * left out
	 *
	 * @param {{packages?: string[], base?: string} | undefined} runtime
	 * @param {{name: string}[]} supplied
	 */
	static libraries(runtime, supplied = []) {
		const { packages = [], base } = runtime ?? {};
		if (!base) return [];
		const named = new Set(supplied.map(({ name }) => name));
		return packages
			.filter(name => !named.has(name))
			.flatMap(name => {
				try {
					return [{ name, path: Component.installed(name, base).path, library: true }];
				} catch {
					return [];
				}
			});
	}

	/**
	 * An installation of the workspace made from given parameters, bounded as the service's installations are
	 * (`BEYOND_INSTALL_DEADLINE`)
	 *
	 * @param {{root: string, members: object[], inputs: object, manifest?: object}} params
	 */
	async installation(params) {
		const Installation = await this.#modules.installation();
		const deadline = Number(this.#context.environment?.BEYOND_INSTALL_DEADLINE);
		return new Installation({ ...params, ...(Number.isFinite(deadline) && deadline > 0 ? { deadline } : {}) });
	}

	/**
	 * The File API of the development extension, or undefined without it
	 */
	get files() {
		return this.#context.services?.get('files');
	}

	/**
	 * The catalog of applications of the development extension, when it shares one
	 */
	get applications() {
		return this.#context.services?.get('applications');
	}

	/**
	 * The served workspace: `reload()` and `published()`
	 */
	get hosted() {
		return this.#context.workspace;
	}
}
