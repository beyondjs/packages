import type { IConditions } from '@beyond-js/packages/types';
import type { BaseModule } from './index';

/**
 * The name of the conditional of a module that declares no platforms. Its output does not depend on the
 * platform, so it satisfies whichever one is requested.
 */
const NEUTRAL = 'default';

/**
 * The conditions requested from the public modules of a workspace, and which conditional of each module
 * satisfies them.
 *
 * A module that declares its platforms is only built for them: requesting another one is an error of the
 * request, reported as such. A module that declares none, which is how a package that only uses `exports`
 * is authored, produces one platform-neutral conditional that satisfies every request. This mapping lives
 * here so that writing artifacts, serving them and launching a consumer agree on it.
 *
 * An environment is part of the request: `web/production` is satisfied by the production conditional of
 * the platform, or by the production conditional of the neutral one, before any development conditional.
 */
export /*bundle*/ class Conditions {
	#values: IConditions;
	get values(): IConditions {
		return this.#values;
	}

	constructor(values: IConditions) {
		if (typeof values?.platform !== 'string' || !values.platform) throw new Error('The platform condition is required');
		this.#values = values;
	}

	/**
	 * How the requested conditions are named in the conditionals of a module: `platform` or
	 * `platform/environment`
	 */
	get key(): string {
		const { platform, environment } = this.#values;
		return environment ? `${platform}/${environment}` : platform;
	}

	/**
	 * The key of the conditional of a module that satisfies the requested conditions. The conditionals of
	 * the module must be ready.
	 *
	 * @returns undefined when the module is not built for the requested conditions
	 */
	select(module: BaseModule): string | undefined {
		const { conditionals } = module;
		const { platform, environment } = this.#values;

		// The requested environment is kept while a conditional satisfies it, so that a platform-neutral
		// module answers a production request with its production conditional and not with its development one
		const neutral = environment ? `${NEUTRAL}/${environment}` : NEUTRAL;
		if (conditionals.has(this.key)) return this.key;
		if (conditionals.has(neutral)) return neutral;
		if (conditionals.has(platform)) return platform;
		if (conditionals.has(NEUTRAL)) return NEUTRAL;
	}
}
