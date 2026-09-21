import type { IProcessedSpec } from '@beyond-js/packages/module';
import type { IProcessorSpec } from '@beyond-js/packages/sdk';

/**
 * The keys of a module manifest that describe the module and are not options of a processor
 */
const RESERVED = ['platforms', 'conditionals', 'subpath', 'description', 'widget', 'assets', 'static'];

/**
 * The specification of one conditional of a module compiled by the TypeScript bundler.
 *
 * A manifest can give a conditional its own values under `conditionals`, keyed by the conditional key
 * (`web`, `node`, `web/production`): they are merged over the values of the module, so one public module
 * can have one entry point for browsers and another for Node, or exclude the sources of the other
 * platform, while keeping one public identity.
 *
 * ```json
 * {
 *   "platforms": ["web", "node"],
 *   "conditionals": {
 *     "web": { "entry": "client/index.ts", "excludes": ["server/**"] },
 *     "node": { "entry": "server/index.ts", "excludes": ["client/**"] }
 *   }
 * }
 * ```
 */
export class Spec {
	static values(values: Record<string, any>, platform: string, environment?: string): IProcessedSpec {
		const { conditionals, ...rest } = values ?? {};
		const merged: Record<string, any> = { ...rest };

		if (conditionals !== void 0) {
			if (!conditionals || typeof conditionals !== 'object' || conditionals instanceof Array) {
				const code = 'CONDITIONALS_INVALID';
				return { values: merged, errors: [{ code, message: 'The "conditionals" of a module manifest must be an object keyed by conditional' }] };
			}
			const keys = [platform, environment ? `${platform}/${environment}` : void 0].filter(Boolean);
			for (const key of keys) {
				const own = conditionals[key];
				if (own === void 0) continue;
				if (!own || typeof own !== 'object' || own instanceof Array) {
					const code = 'CONDITIONALS_INVALID';
					return { values: merged, errors: [{ code, message: `The "conditionals.${key}" of a module manifest must be an object` }] };
				}
				Object.assign(merged, own);
			}
		}
		return { values: merged };
	}

	/**
	 * The values a processor receives: everything of the conditional that is not a reserved module key
	 */
	static processor(values: Record<string, any>, specifier: string, extra: Record<string, any> = {}): IProcessorSpec {
		const spec: Record<string, any> = {};
		for (const [key, value] of Object.entries(values ?? {})) {
			if (RESERVED.includes(key)) continue;
			spec[key] = value;
		}
		return { specifier, ...spec, ...extra };
	}
}
