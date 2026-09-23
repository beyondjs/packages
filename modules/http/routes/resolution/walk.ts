import type { Delivery, IDelivered } from '@beyond-js/packages/artifacts';
import { Installed } from '@beyond-js/packages/artifacts';
import { type Options, Identity, ModulePath, ResourcePath } from '@beyond-js/artifact-api';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { Sources } from '../modules/sources';
import type { Table } from './table';

interface IImporter {
	/**
	 * The directory the importer resolves installed packages from
	 */
	path: string;

	/**
	 * The origin-relative prefix of the importer's package, which is its scope
	 */
	prefix: string;
}

/**
 * The installed packages and the selected stylesheets that the browser modules of a workspace reach, walked
 * once for one resolution
 */
export class Walk {
	#delivery: Delivery;
	#sources: Sources;
	#options: Options;
	#table: Table;
	#visited: Set<string> = new Set();

	constructor(delivery: Delivery, sources: Sources, options: Options, table: Table) {
		this.#delivery = delivery;
		this.#sources = sources;
		this.#options = options;
		this.#table = table;
	}

	/**
	 * The origin-relative package prefix of a module path: `/m/@example/app@1.0.0/`
	 */
	static prefix(path: string): string {
		return path.slice(0, path.indexOf('/modules/') + 1);
	}

	/**
	 * Splits a public specifier into the package name and the subpath in the spelling of package manifests
	 */
	static parse(specifier: string): { name: string; subpath: string } {
		const segments = specifier.split('/');
		const name = segments.splice(0, specifier.startsWith('@') ? 2 : 1).join('/');
		return { name, subpath: segments.length ? `./${segments.join('/')}` : '.' };
	}

	/**
	 * The installed packages and the stylesheets a built module imports
	 */
	async dependencies(delivered: IDelivered, importer: IImporter): Promise<void> {
		for (const dependency of delivered.dependencies ?? []) {
			if (dependency.source === 'external') await this.#external(dependency.specifier, importer);
		}

		// The runtime a composed module imports is named apart; one the workspace contains is already resolved
		const { runtime } = delivered;
		const published = runtime && (await this.#delivery.published()).some(module => module.specifier === runtime);
		if (runtime && !published) await this.#external(runtime, importer);
		for (const specifier of (<{ stylesheets?: string[] }>delivered).stylesheets ?? []) await this.#stylesheet(specifier, importer);
	}

	async #identity(specifier: string, importer: IImporter): Promise<Identity | undefined> {
		const { name, subpath } = Walk.parse(specifier);
		const version = Installed.version(name, importer.path);
		if (!version) return;
		const { registry } = await this.#sources.origin(name, version);
		return registry ? new Identity({ registry, name, version, subpath }) : void 0;
	}

	async #external(specifier: string, importer: IImporter): Promise<void> {
		const identity = await this.#identity(specifier, importer);
		if (!identity) return;

		const path = ModulePath.format(identity);
		this.#table.add(specifier, `${path}?${this.#options.query}`, importer.prefix);
		if (this.#visited.has(path)) return;
		this.#visited.add(path);

		const { name, version, subpath } = identity;
		const { delivered } = await this.#delivery.module({ name, version, subpath }, this.#options.conditions);
		if (delivered?.styles) this.#table.add(`${specifier}.css`, `${ResourcePath.format({ kind: 'style', identity })}?${this.#options.query}`, importer.prefix);
		const root = this.#delivery.installed?.locate(name, version);
		if (delivered && root) await this.dependencies(delivered, { path: root, prefix: Walk.prefix(path) });
	}

	/**
	 * A stylesheet selected by specifier (`pkg/sub.css`): the stylesheet of the public module `./sub`, unless the
	 * package publishes `./sub.css` itself, as an npm package that exports a stylesheet does
	 */
	async #stylesheet(specifier: string, importer: IImporter): Promise<void> {
		const literal = Walk.parse(specifier);
		const published = await this.#delivery.published();
		const own = published.find(module => module.name === literal.name);
		const exported = own ? published.some(module => module.name === literal.name && module.subpath === literal.subpath) : this.#exports(literal.name, literal.subpath, importer.path);
		const selected = exported ? specifier : specifier.replace(/\.css$/, '');

		const identity = own ? new Identity({ name: own.name, version: own.version, subpath: Walk.parse(selected).subpath }) : await this.#identity(selected, importer);
		if (!identity) return;
		const path = ResourcePath.format({ kind: 'style', identity });
		this.#table.add(specifier, `${path}?${this.#options.query}`, own ? void 0 : importer.prefix);
	}

	/**
	 * Whether an installed package publishes a subpath literally
	 */
	#exports(name: string, subpath: string, from: string): boolean {
		const root = Installed.root(name, from);
		try {
			const { exports } = root ? JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) : <{ exports?: unknown }>{};
			return !!exports && typeof exports === 'object' && Object.prototype.hasOwnProperty.call(exports, subpath);
		} catch {
			return false;
		}
	}
}
