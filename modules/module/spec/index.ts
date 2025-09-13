import type { ExportsType, IManifestModuleSpec } from '@beyond-js/packages/types';
import { DynamicProcessor } from '@beyond-js/dynamic-processor/main';
import { equal } from '@beyond-js/equal/main';

export /*bundle*/ type ModuleSpecType = ExportsType | IManifestModuleSpec;

export /*bundle*/ interface IExportInfo {
	type: 'export';
	subpath: string;
}

export /*bundle*/ interface IModuleManifestInfo {
	type: 'manifest';
	path: string;
	language?: string;
	[key: string]: any;
}

type IModuleInfo = IExportInfo | IModuleManifestInfo;

export /*bundle*/ class ModuleSpec extends DynamicProcessor() {
	get dp() {
		return 'module-manifest.module-spec';
	}

	#type: 'export' | 'manifest';
	get type() {
		return this.#type;
	}

	#subpath?: string;
	get subpath() {
		return this.#subpath ? this.#subpath : (<IManifestModuleSpec>this.#values).subpath;
	}

	#path?: string;
	get path() {
		return this.#path;
	}

	#language?: string;
	get language() {
		return this.#language;
	}

	#bundler: string;
	get bundler() {
		return this.#bundler;
	}

	#values: ModuleSpecType;
	get values() {
		return this.#values;
	}

	/**
	 * Creates a module specification instance
	 *
	 * @param info The module specification information
	 * @param bundler The bundler name (for exports it's always 'exports', for manifests it's the bundler name)
	 */
	constructor(info: IModuleInfo, bundler: string) {
		super();

		const { type } = info;
		this.#type = type;

		if (type === 'export') {
			const { subpath } = info;
			this.#subpath = subpath;
		} else if (type === 'manifest') {
			const { path, language } = info;
			this.#path = path;
			this.#language = language;
		} else {
			throw new Error(`Unknown module spec type: ${type}`);
		}

		this.#bundler = bundler;
	}

	update(values: ModuleSpecType) {
		values = values || {};

		const changed = !equal(values, this.#values);
		if (!changed) return;

		this.#values = values;
		this._invalidate();
	}
}
