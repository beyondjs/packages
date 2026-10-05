import type { IBuildable, IPublishedModule } from '../builds';
import type { Addresses } from './addresses';
import type { Imports } from './imports';
import type { IPreviewModule } from './types';
import type { IImporter } from './locator';
import type { Instances } from './instances';
import { Externals } from './externals';

interface ISettings {
	delivery: IBuildable;
	selected: (module: IPublishedModule) => boolean;
	addresses: Addresses;
	externals: Externals;
	imports: Imports;

	/**
	 * The installed graph, when the workspace is served from its execution projection
	 */
	instances?: Instances;

	/**
	 * The public modules of the workspace
	 */
	known: () => IPublishedModule[];

	/**
	 * The registry a package of the workspace is published to
	 */
	registry: (module: IPublishedModule) => Promise<string | undefined>;
	report: (code: string, message: string) => void;
}

type Selected = { specifier: string; vspecifier: string; url: string };

/**
 * The stylesheets the sources of a module select by specifier (`import 'pkg/sub.css'`), which the build keeps
 * out of the code and names apart: each one is the stylesheet of the public module `pkg/sub`, or of `pkg/sub.css`
 * when the package publishes that subpath itself, as an npm package that exports a stylesheet does. It is served
 * where the module is (this environment for a module in development or an installed package, the CDN
 * otherwise) and the specifier enters the import map with that address, so the runtime finds it by specifier.
 * Nothing here decides who applies it: the document links the ones in its scope, and a widget adopts its own.
 *
 * In an installed workspace `pkg` is the instance the importer's edges select, and every stylesheet of the graph
 * is served by this environment.
 */
export class Stylesheets {
	#settings: ISettings;

	constructor(settings: ISettings) {
		this.#settings = settings;
	}

	/**
	 * Records the stylesheets a module selects
	 */
	async select(module: IPreviewModule, specifiers: string[] | undefined, importer: IImporter): Promise<void> {
		const { imports, instances } = this.#settings;
		for (const specifier of specifiers ?? []) {
			// In an installed graph a stylesheet is never looked for elsewhere than the importer's edges
			const selected = !instances ? await this.#resolve(specifier, importer) : importer.key ? await this.#installed(specifier, importer) : this.#unknown(specifier, importer);
			if (!selected) continue;

			const listed = module.stylesheets?.some(one => one.specifier === specifier && one.url === selected.url);
			!listed && (module.stylesheets ??= []).push(selected);
			instances ? imports.bind(specifier, selected.url, importer.prefix, Stylesheets.#from(importer)) : imports.add(specifier, selected.url, importer.prefix);
		}
	}

	static #vspecifier(name: string, version: string, subpath: string): string {
		return subpath === '.' ? `${name}@${version}` : `${name}@${version}/${subpath.slice(2)}`;
	}

	static #from(importer: IImporter): string {
		return importer.module.specifier ?? importer.module.vspecifier;
	}

	/**
	 * A stylesheet selected by an importer the installed graph does not know, such as a member declared after it was
	 * installed: nothing can be selected for it, on the disk, in the toolchain or on the CDN
	 */
	#unknown(specifier: string, importer: IImporter): undefined {
		const reason = 'the package that imports it is not in the installed graph of the workspace: run beyond install';
		this.#settings.report('DEPENDENCY_NOT_INSTALLED', `"${specifier}", imported by "${Stylesheets.#from(importer)}": ${reason}`);
		return void 0;
	}

	async #resolve(specifier: string, importer: IImporter): Promise<Selected | undefined> {
		const { addresses, externals, delivery, report } = this.#settings;
		const stripped = specifier.replace(/\.css$/, '');
		const literal = Externals.parse(specifier);
		const published = this.#settings.known();
		const from = Stylesheets.#from(importer);

		if (published.some(module => module.name === literal.name)) {
			const find = (subpath: string) => published.find(module => module.name === literal.name && module.subpath === subpath);
			const module = find(literal.subpath) ?? find(Externals.parse(stripped).subpath);
			if (!module) return void report('PREVIEW_STYLESHEET_NOT_FOUND', `"${specifier}", imported by "${from}": the workspace publishes no such stylesheet`);

			const { name, version, subpath } = module;
			const url = this.#settings.selected(module) ? addresses.styles(name, version, subpath) : addresses.stylesheet(name, version, subpath, await this.#settings.registry(module));
			return url && { specifier, vspecifier: module.vspecifier, url };
		}

		const chosen = (await externals.exports(specifier, importer.path)) ? specifier : stripped;
		const { name, subpath, version, reason } = await externals.resolve(chosen, importer.path);
		if (!version) return void report('PREVIEW_VERSION_UNRESOLVED', `"${specifier}", imported by "${from}": ${reason}`);

		const origin = (await delivery.origin?.(name, version)) ?? { registry: 'npm' };
		if (!origin.registry) return void report('PREVIEW_SOURCE_UNSUPPORTED', `"${specifier}", imported by "${from}": ${origin.reason}`);
		const url = (await delivery.supplies?.(name, version)) ? addresses.styles(name, version, subpath, origin.registry) : addresses.stylesheet(name, version, subpath, origin.registry);
		return url && { specifier, vspecifier: Stylesheets.#vspecifier(name, version, subpath), url };
	}

	/**
	 * The stylesheet of the instance the importer binds `pkg` to: a member's own public module, or the subpath of an
	 * installed instance, both served by this environment
	 */
	async #installed(specifier: string, importer: IImporter): Promise<Selected | undefined> {
		const { addresses, instances, report } = this.#settings;
		const literal = Externals.parse(specifier);
		const stripped = Externals.parse(specifier.replace(/\.css$/, '')).subpath;
		const from = Stylesheets.#from(importer);

		const { node, error } = instances.bind(importer.key, literal.name, importer.chain ?? []);
		if (error) return void report(error.code, `"${specifier}", imported by "${from}": ${error.message}`);

		if (instances.member(node)) {
			const published = this.#settings.known();
			const find = (subpath: string) => published.find(one => one.name === node.name && one.version === node.version && one.subpath === subpath);
			const module = find(literal.subpath) ?? find(stripped);
			if (!module) return void report('PREVIEW_STYLESHEET_NOT_FOUND', `"${specifier}", imported by "${from}": "${node.name}@${node.version}" publishes no such stylesheet`);
			return { specifier, vspecifier: module.vspecifier, url: addresses.styles(node.name, node.version, module.subpath) };
		}

		const origin = await instances.origin(node);
		if (!origin.registry) return void report('PREVIEW_SOURCE_UNSUPPORTED', `"${specifier}", imported by "${from}": ${origin.reason}`);
		const subpath = (await instances.exports(node, literal.subpath)) ? literal.subpath : stripped;
		const url = addresses.styles(node.name, node.version, subpath, origin.registry);
		return { specifier, vspecifier: Stylesheets.#vspecifier(node.name, node.version, subpath), url };
	}
}
