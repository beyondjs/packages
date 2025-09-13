import type { IModuleManifestInfo } from '@beyond-js/packages/module/spec';
import { BaseModule } from '@beyond-js/packages/sdk';
import { ESM } from './esm';

export /*bundle*/ class Module extends BaseModule {
	_conditionals() {
		const spec = <IModuleManifestInfo>this.spec.values;
		let platforms: string[] = spec.platforms;
		platforms = typeof platforms === 'string' ? [platforms] : platforms;
		platforms = platforms || ['default'];
		platforms = platforms?.filter(platform => platform && typeof platform === 'string');
		platforms = platforms instanceof Array ? platforms : ['default'];

		// !platforms.includes('types') && platforms.push('types');

		const conditionals = platforms.map(platform => ({ platform }));
		return conditionals;
	}

	_conditional({ conditions }: { key: string; conditions: { platform: string } }) {
		const { platform } = conditions;
		return new ESM(this, { platform });

		// if (platform === 'types') {
		// 	return new TypesConditional(this, { platform });
		// } else {
		// 	return new Conditional(this, { platform });
		// }
	}
}
