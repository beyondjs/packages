import type { IBuildable, IPublishedModule } from '../builds';
import type { IImporter, ILocated, ILocator } from './locator';
import { Addresses } from './addresses';
import { Externals } from './externals';

/**
 * What the modules of a workspace import, found as Node finds installed packages on the disk.
 *
 * A module of the workspace is found by the versioned identity the host classified it with, or by its specifier.
 * Anything else is a package the workspace does not contain, at the version installed for the package that
 * imports it (`Externals`), addressed under the registry the host reports for it and loaded from this environment
 * when the host delivers that installation to browsers, and from the CDN otherwise.
 */
export class DiskLocator implements ILocator {
	readonly installed = false;

	#delivery: IBuildable;
	#externals: Externals;

	constructor(delivery: IBuildable, externals: Externals) {
		this.#delivery = delivery;
		this.#externals = externals;
	}

	static #specifier({ specifier, name, subpath }: IPublishedModule): string {
		return specifier ?? (subpath === '.' ? name : `${name}/${subpath.replace(/^\.\//, '')}`);
	}

	async locate(specifier: string, importer: IImporter, runtime: boolean, vspecifier: string | undefined, published: IPublishedModule[]): Promise<ILocated> {
		// A runtime that the workspace itself contains is one more public module of the workspace
		const local = published.find(one => (vspecifier ? one.vspecifier === vspecifier : DiskLocator.#specifier(one) === specifier));
		if (local) return { local, name: local.name, subpath: local.subpath };

		const { name, subpath, version, reason } = await this.#externals.resolve(specifier, importer.path, runtime);
		if (!version) return { name, subpath, reason, code: 'PREVIEW_VERSION_UNRESOLVED' };

		const origin = (await this.#delivery.origin?.(name, version)) ?? { registry: 'npm' };
		if (!origin.registry) return { name, subpath, version, unsupported: origin.reason };

		// An installed package this environment compiles for browsers is loaded from the environment
		const served = !!(await this.#delivery.supplies?.(name, version));
		return { name, subpath, version, registry: origin.registry, served };
	}

	local(module: IPublishedModule, url: string | undefined): IImporter {
		return { module, path: module.path, prefix: url && Addresses.prefix(url) };
	}

	/**
	 * What an installation imports resolves from the installation, and is scoped to its package
	 */
	async nested(located: ILocated, importer: IImporter, url: string): Promise<IImporter> {
		const path = (await this.#externals.root(located.name, importer.path)) ?? importer.path;
		return { module: importer.module, path, prefix: Addresses.prefix(url) };
	}

	exports(specifier: string, importer: IImporter): Promise<boolean> {
		return this.#externals.exports(specifier, importer.path);
	}

	/**
	 * The module of the workspace that publishes the coordinator's specifier
	 */
	coordinator(specifier: string, published: IPublishedModule[]): IPublishedModule | undefined {
		return published.find(module => DiskLocator.#specifier(module) === specifier);
	}
}
