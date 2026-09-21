import type { IModuleManifestInfo } from '@beyond-js/packages/module/spec';
import { BaseModule } from '@beyond-js/packages/sdk';
import { ESM } from './esm';
import { Types } from './types';

/**
 * The TypeScript bundler: the runtime-composition mode of a public module.
 *
 * Every platform the module declares is one ESM conditional, whose artifact registers one creator per
 * source file in the runtime the package selects. A `types` conditional is added for the semantic check
 * of the sources and the public declaration of the module; it is not an executable artifact, and the
 * consumers that deliver code never select it.
 */
export /*bundle*/ class Module extends BaseModule {
	static TYPES = 'types';

	_conditionals() {
		const spec = <IModuleManifestInfo>this.spec.values;
		let platforms: string[] = spec.platforms;
		platforms = typeof platforms === 'string' ? [platforms] : platforms;
		platforms = platforms || ['default'];
		platforms = platforms?.filter(platform => platform && typeof platform === 'string' && platform !== Module.TYPES);
		platforms = platforms instanceof Array && platforms.length ? platforms : ['default'];

		return [...platforms.map(platform => ({ platform })), { platform: Module.TYPES }];
	}

	_conditional({ conditions }: { key: string; conditions: { platform: string } }) {
		const { platform } = conditions;
		return platform === Module.TYPES ? new Types(this, { platform }) : new ESM(this, { platform });
	}
}
