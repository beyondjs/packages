import type { IPublishedModule } from '../builds';
import type { ISpecified } from './request';

/**
 * The public modules the service publishes (the workspace's and the ones the toolchain supplies), as type browsing
 * looks them up: by specifier, by package and by the importer a request names
 */
export class Modules {
	#published: IPublishedModule[];

	get published() {
		return this.#published;
	}

	constructor(published: IPublishedModule[]) {
		this.#published = published;
	}

	static #specifier(module: IPublishedModule): string {
		return module.subpath === '.' ? module.name : `${module.name}/${module.subpath.slice(2)}`;
	}

	/**
	 * The public module a specifier names: a versioned specifier names one version; a bare one the first version the
	 * service lists, as `GET /declarations` resolves it
	 */
	find({ name, subpath, version }: ISpecified): IPublishedModule | undefined {
		return this.#published.find(module => module.name === name && module.subpath === subpath && (!version || module.version === version));
	}

	/**
	 * Whether a package name is published by the service, at any version
	 */
	owns(name: string): boolean {
		return this.#published.some(module => module.name === name);
	}

	/**
	 * A module of the package an importer names, by its module or package specifier, bare or versioned: what matters
	 * of it is its package
	 */
	importer({ name, subpath, version }: ISpecified): IPublishedModule | undefined {
		const modules = this.#published.filter(module => module.name === name && (!version || module.version === version));
		return modules.find(module => module.subpath === subpath) ?? modules[0];
	}

	/**
	 * A module of a package at a version, or of its first version
	 */
	of(name: string, version?: string): IPublishedModule | undefined {
		return this.#published.find(module => module.name === name && (!version || module.version === version));
	}

	/**
	 * The specifiers of the modules of a package, for a message that says what it publishes
	 */
	names(name: string): string[] {
		return this.#published.filter(module => module.name === name).map(module => Modules.#specifier(module));
	}
}
