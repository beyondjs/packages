import type { IPublishedModule } from '../builds';

/**
 * Where a preview loads what the workspace does not develop: the externals of the development selection.
 *
 * `environment`, the default, is what a preview always did: an installed package this environment compiles for
 * browsers (React, Vue, the libraries of the adapters) is served by this environment. `cdn` addresses those
 * packages on the CDN at their installed exact version instead, through the one import map of the page, so every
 * importer reaches one copy of a framework. Under `cdn` the packages the toolchain supplies and publishes nowhere
 * (the development runtime, Widgets and its adapters) stay on this environment whatever the selection says, which
 * the record of each of their modules says; under `environment` they follow the selection, as before.
 *
 * A workspace served from its installed graph (`beyond install`) is not routed by this policy: every node of the
 * graph is served by this environment, which `reason` says.
 */
export class Policy {
	static DEFAULT: Externals = 'environment';

	/**
	 * Why a supplied package is on this environment whatever the selection says
	 */
	static SUPPLIED = 'Supplied by the toolchain and published in no registry: this environment serves it';

	#value: Externals;
	#installed: boolean;

	/**
	 * @param value The externals of the selection
	 * @param installed Whether the walk follows an installed graph, all of whose nodes this environment serves
	 */
	constructor(value: Externals = Policy.DEFAULT, installed = false) {
		this.#value = value;
		this.#installed = installed;
	}

	get value(): Externals {
		return this.#value;
	}

	/**
	 * Whether the externals of this page are asked of the CDN, and its addresses checked before they are given
	 */
	get cdn(): boolean {
		return this.#value === 'cdn' && !this.#installed;
	}

	/**
	 * Why the policy does not decide where the externals come from, when it does not
	 */
	get reason(): string | undefined {
		if (this.#value !== 'cdn' || !this.#installed) return;
		return 'The workspace is installed (beyond install): this environment serves every node of its installed graph, so no external is asked of the CDN';
	}

	/**
	 * Whether a module of a package the toolchain supplies stays on this environment although the selection does
	 * not put it in development: under the `cdn` policy, because the CDN cannot hold what is published nowhere
	 */
	kept(module: IPublishedModule): boolean {
		return this.cdn && !!module.supplied;
	}
}

export type Externals = 'environment' | 'cdn';
