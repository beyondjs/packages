import type { IBuildable, IPublishedModule } from '../builds';
import type { Addresses } from './addresses';
import type { Imports } from './imports';
import type { IPreviewModule } from './graph';
import { Externals } from './externals';

interface IImporter {
	module: IPublishedModule;
	path?: string;
	prefix?: string;
}

interface ISettings {
	delivery: IBuildable;
	selected: (module: IPublishedModule) => boolean;
	addresses: Addresses;
	externals: Externals;
	imports: Imports;

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

/**
 * The stylesheets the sources of a module select by specifier (`import 'pkg/sub.css'`), which the build keeps
 * out of the code and names apart: each one is the stylesheet of the public module `pkg/sub`, or of `pkg/sub.css`
 * when the package publishes that subpath itself, as an npm package that exports a stylesheet does. It is served
 * where the module is (this environment for a module in development or an installed package, the CDN
 * otherwise) and the specifier enters the import map with that address, so the runtime finds it by specifier.
 * Nothing here decides who applies it: the document links the ones in its scope, and a widget adopts its own.
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
		for (const specifier of specifiers ?? []) {
			const selected = await this.#resolve(specifier, importer);
			if (!selected) continue;
			(module.stylesheets ??= []).push(selected);
			this.#settings.imports.add(specifier, selected.url, importer.prefix);
		}
	}

	static #vspecifier(name: string, version: string, subpath: string): string {
		return subpath === '.' ? `${name}@${version}` : `${name}@${version}/${subpath.slice(2)}`;
	}

	async #resolve(specifier: string, importer: IImporter): Promise<{ specifier: string; vspecifier: string; url: string } | undefined> {
		const { addresses, externals, delivery, report } = this.#settings;
		const stripped = specifier.replace(/\.css$/, '');
		const literal = Externals.parse(specifier);
		const published = this.#settings.known();
		const from = importer.module.specifier ?? importer.module.vspecifier;

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
}
