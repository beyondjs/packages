import type { IModuleManifestInfo } from '@beyond-js/packages/module/spec';
import { BaseModule } from '@beyond-js/packages/sdk';
import { Packaged } from './packaged';

/**
 * The esbuild packaging mode of a public module.
 *
 * A module selects it the way it selects any bundler: through `bundler` in its manifest or the default
 * bundler of its package, so two modules of one package can be compiled in different modes. The sources of
 * the module are bundled into one native ES module that keeps its public references bare. Its artifact
 * carries no internal modules and needs no Beyond runtime, which is the difference with the TypeScript
 * bundler, whose artifact registers one creator per source file for the runtime to update.
 */
export /*bundle*/ class Module extends BaseModule {
	_conditionals() {
		const spec = <IModuleManifestInfo>this.spec.values;
		let platforms: string[] = typeof spec.platforms === 'string' ? [spec.platforms] : spec.platforms;
		platforms = platforms instanceof Array ? platforms.filter(platform => platform && typeof platform === 'string') : [];
		// Each platform is built for development use and as a minified production distribution
		return (platforms.length ? platforms : ['default']).flatMap(platform => [
			{ platform },
			{ platform, environment: 'production' }
		]);
	}

	_conditional({ conditions }: { key: string; conditions: { platform: string; environment?: string } }) {
		return new Packaged(this, conditions);
	}
}
