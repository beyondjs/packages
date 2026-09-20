import type { IDiagnostic } from '@beyond-js/packages/types';
import { Distribution } from '@beyond-js/packages/publication';
import type { IAnalysisConditions } from '../types';
import { Opened, type IPublicModule } from './opened';
import { Specifier } from '../specifier';

/**
 * A package published as a precompiled distribution. Everything is read from its distribution manifest:
 * nothing is compiled or parsed, so it has no entry points.
 */
export /*bundle*/ class DistributedPackage extends Opened {
	#distribution: Promise<Distribution>;

	/**
	 * The reader of the distribution, which also returns its prebuilt outputs
	 */
	get distribution(): Promise<Distribution> {
		return (this.#distribution = this.#distribution ?? Distribution.open(this.root, this.publication.manifest));
	}

	async module(subpath: string, conditions: IAnalysisConditions) {
		void conditions;
		const distribution = await this.distribution;
		if (!distribution.valid) return { diagnostics: distribution.diagnostics };

		const distributed = distribution.modules.get(subpath);
		if (!distributed) {
			const message = `Distribution "${this.key}" does not hold "${Specifier.of(this.name, subpath)}"`;
			return { diagnostics: <IDiagnostic[]>[{ code: 'MODULE_NOT_FOUND', message }] };
		}

		const module: IPublicModule = { subpath, kind: distributed.kind, assets: distributed.assets ?? [], dynamic: [], distributed };
		return { module, diagnostics: <IDiagnostic[]>[] };
	}

	async listed(path: string) {
		const listed = (await this.distribution).manifest?.assets[path];
		return listed && { media: listed.media, digest: listed.digest, bytes: listed.bytes };
	}

	async entries(): Promise<Map<string, string>> {
		return new Map();
	}
}
