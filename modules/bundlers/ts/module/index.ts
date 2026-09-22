import type { IModuleManifestInfo } from '@beyond-js/packages/module/spec';
import { BaseModule } from '@beyond-js/packages/sdk';
import { ESM } from './esm';
import { Types } from './types';

/**
 * The TypeScript bundler: the runtime-composition mode of a public module.
 *
 * Every platform the module declares is one ESM conditional, whose artifact registers one creator per
 * source file in the runtime the package selects. A platform a browser can be given also gets a production
 * conditional (`web/production`, and `default/production` for a module that declares no platforms): the
 * same composition, minified, without a source map or an update patch, which is what a request for
 * production output is answered with. A `types` conditional is added for the semantic
 * check of the sources and the public declaration of the module; it is not an executable artifact, and
 * the consumers that deliver code never select it.
 */
export /*bundle*/ class Module extends BaseModule {
	static TYPES = 'types';
	static PRODUCTION = 'production';

	/**
	 * The platforms whose output a browser can be given: the declared browser platform, and the neutral
	 * conditional of a module that declares none, which satisfies whichever platform is requested. Both
	 * get a production conditional, so that a stylesheet or a module published only through `exports` is
	 * delivered as production output like any other.
	 */
	static BROWSERS = ['web', 'default'];

	_conditionals() {
		const spec = <IModuleManifestInfo>this.spec.values;
		let platforms: string[] = spec.platforms;
		platforms = typeof platforms === 'string' ? [platforms] : platforms;
		platforms = platforms || ['default'];
		platforms = platforms?.filter(platform => platform && typeof platform === 'string' && platform !== Module.TYPES);
		platforms = platforms instanceof Array && platforms.length ? platforms : ['default'];

		const browsers = platforms.filter(platform => Module.BROWSERS.includes(platform));
		const production = browsers.map(platform => ({ platform, environment: Module.PRODUCTION }));
		return [...platforms.map(platform => ({ platform })), ...production, { platform: Module.TYPES }];
	}

	_conditional({ conditions }: { key: string; conditions: { platform: string; environment?: string } }) {
		const { platform, environment } = conditions;
		return platform === Module.TYPES ? new Types(this, { platform }) : new ESM(this, environment ? { platform, environment } : { platform });
	}
}
