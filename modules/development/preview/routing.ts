import type { IBuildable, IPublishedModule } from '../builds';
import { Addresses } from './addresses';
import type { Externals } from './externals';
import type { ILocated } from './locator';
import type { Records } from './records';
import type { IPreviewModule } from './types';

type Delivered = Awaited<ReturnType<IBuildable['module']>>['delivered'];

interface ISettings {
	delivery: IBuildable;
	selected: (module: IPublishedModule) => boolean;
	addresses: Addresses;
	externals: Externals;
	records: Records;

	/**
	 * Whether the walk reaches the nodes of an installed graph, all of which this environment serves
	 */
	installed: boolean;
}

/**
 * Where each module of a preview is loaded from, and the record that says so.
 *
 * A module of the workspace comes from the environment when it is selected for development, or when it is a
 * member of an installed graph, and from the CDN otherwise, under the registry its `publishConfig` names. A
 * package the workspace does not contain comes from where its importer located it: the environment when it serves
 * that installation, the CDN otherwise; one without an exact version or without a registry address is reported and
 * has no address. An address is never invented: without a CDN origin a module that is not served here has none.
 */
export class Routing {
	static #WEB = { platform: 'web', environment: 'development' };

	#settings: ISettings;

	/**
	 * The code of the diagnostic of each record that has no address, by record
	 */
	#unaddressed: Map<string, string> = new Map();

	constructor(settings: ISettings) {
		this.#settings = settings;
	}

	static #specifier({ specifier, name, subpath }: IPublishedModule): string {
		return specifier ?? (subpath === '.' ? name : `${name}/${subpath.replace(/^\.\//, '')}`);
	}

	/**
	 * The registry a package of the workspace is published to, which is where the CDN delivers it from
	 */
	async registry(module: IPublishedModule): Promise<string | undefined> {
		const base = await this.#settings.externals.publication(module.path);
		return base ? await this.#settings.delivery.registry?.(base) : void 0;
	}

	#published(module: IPreviewModule, name: string, version: string, subpath: string, registry?: string): IPreviewModule {
		const url = this.#settings.addresses.published(name, version, subpath, registry);
		if (url) return Object.assign(module, { source: 'cdn', version, url });

		const reason = `No CDN origin is configured (${Addresses.VARIABLE} is not set)`;
		this.#settings.records.report('PREVIEW_CDN_UNSET', `"${module.specifier}" is not in development and ${reason.charAt(0).toLowerCase()}${reason.slice(1)}`);
		return Object.assign(module, { source: 'unresolved', version, reason });
	}

	/**
	 * The record of a module of the workspace; one in development is listed for the runtime of the page
	 */
	async workspace(module: IPublishedModule): Promise<IPreviewModule> {
		const { addresses, records, installed } = this.#settings;
		const specifier = Routing.#specifier(module);
		const { name, version, subpath } = module;
		const entry: IPreviewModule = { specifier, source: 'environment', version };

		const selected = this.#settings.selected(module);
		if (selected) records.update(specifier, { package: name, vspecifier: module.vspecifier, path: addresses.path(name, version, subpath) });
		if (!selected && !installed) return this.#published(entry, name, version, subpath, await this.registry(module));
		return Object.assign(entry, { vspecifier: module.vspecifier, url: addresses.environment(name, version, subpath) });
	}

	/**
	 * The record of a package the workspace does not contain, created when an importer first locates it. A node of an
	 * installed graph is compiled first: one that does not build, or whose sources are missing, is given no address
	 *
	 * @param id The record's id
	 * @param from The module of the workspace whose walk reached it, which a report names
	 * @returns The record, whether it existed, and what compiling it delivered
	 */
	async record(id: string, specifier: string, located: ILocated, from: string): Promise<{ module: IPreviewModule; known: boolean; delivered?: Delivered }> {
		const { records, delivery, installed } = this.#settings;
		const known = records.get(id);
		if (known) return { module: known, known: true };
		const { module, code } = this.external(specifier, located, from);
		records.add(id, module);
		code && this.#unaddressed.set(id, code);
		if (!installed || module.source !== 'environment') return { module, known: false };

		const { name, version, subpath } = located;
		const { delivered, failure } = await delivery.module({ name, version, subpath, vspecifier: `${name}@${version}` }, Routing.#WEB);
		failure && this.#unaddressed.set(id, this.failed(module, failure, from));
		return { module, known: false, delivered };
	}

	/**
	 * The code of the diagnostic of a record that has no address
	 */
	code(id: string): string | undefined {
		return this.#unaddressed.get(id);
	}

	/**
	 * The record of a package the workspace does not contain, as its importer located it, with the code of the
	 * diagnostic of one that has no address
	 *
	 * @param from The module of the workspace whose walk reached it, which a report names
	 */
	external(specifier: string, located: ILocated, from: string): { module: IPreviewModule; code?: string } {
		const { name, version, subpath, registry } = located;
		const module: IPreviewModule = { specifier, source: 'unresolved', ...(version ? { version } : {}) };

		if (!version || (!registry && !located.unsupported)) {
			const code = located.code ?? 'PREVIEW_VERSION_UNRESOLVED';
			return { module: this.#unresolved(module, code, located.reason, from), code };
		}
		if (!registry) return { module: this.#unresolved(module, 'PREVIEW_SOURCE_UNSUPPORTED', located.unsupported, from), code: 'PREVIEW_SOURCE_UNSUPPORTED' };
		if (!located.served) return { module: this.#published(module, name, version, subpath, registry) };

		const vspecifier = subpath === '.' ? `${name}@${version}` : `${name}@${version}/${subpath.slice(2)}`;
		const url = this.#settings.addresses.environment(name, version, subpath, registry);
		return { module: Object.assign(module, { source: 'environment', version, vspecifier, url }) };
	}

	/**
	 * Takes the address back from the record of a node that does not build or whose sources are missing, which a page
	 * would otherwise load as if it were served
	 *
	 * @returns The code of its diagnostic
	 */
	failed(module: IPreviewModule, failure: { code: string; message: string; diagnostics?: { code: string; message: string }[] }, from: string): string {
		const cause = failure.diagnostics?.find(({ code }) => code === 'SOURCE_MISSING') ?? failure;
		delete module.url;
		delete module.vspecifier;
		this.#unresolved(module, cause.code, cause.message, from);
		return cause.code;
	}

	#unresolved(module: IPreviewModule, code: string, reason: string, from: string): IPreviewModule {
		this.#settings.records.report(code, `"${module.specifier}", imported by "${from}": ${reason}`);
		return Object.assign(module, { source: 'unresolved', reason });
	}
}
