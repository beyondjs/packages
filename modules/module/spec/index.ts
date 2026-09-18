import type { ExportsType, IManifestModuleSpec } from '@beyond-js/packages/types';
import { DynamicProcessor } from '@beyond-js/dynamic-processor/main';
import { equal } from '@beyond-js/equal/main';
import { posix } from 'path';

export /*bundle*/ type ModuleSpecType = ExportsType | IManifestModuleSpec;

/**
 * A module declared by an entry of the package exports
 */
export /*bundle*/ interface IExportInfo {
	type: 'export';
	subpath: string;
}

/**
 * A module declared by a manifest found in the package
 */
export /*bundle*/ interface IModuleManifestInfo {
	type: 'manifest';
	path: string;
	language?: string;
	[key: string]: any;
}

type IModuleInfo = IExportInfo | IModuleManifestInfo;

/**
 * The values of a module specification once its declarations are combined. Besides the entry point, they
 * are the configuration of its bundler, such as the platforms to build or the files to process.
 */
export /*bundle*/ interface IModuleSpecValues {
	/**
	 * The source file that defines the public API of the module, relative to its directory
	 */
	entry?: string;

	[key: string]: any;
}

/**
 * The extensions of an exports target that Beyond compiles as the entry point of a public module.
 * Any other target, such as an already built file, is packaged by the exports bundler instead.
 */
const SOURCE_EXTNAMES = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts'];

/**
 * The specification of a public module: which subpath of the package it publishes, where its sources are,
 * which source file is its entry point, which bundler compiles it and how that bundler is configured.
 *
 * A module is declared by an entry of the package exports, by a manifest in its directory, or by both, and
 * the collection of modules of the package combines those declarations into this specification. Changing
 * any of them invalidates this object, and with it the module and the outputs derived from it.
 */
export /*bundle*/ class ModuleSpec extends DynamicProcessor() {
	get dp() {
		return 'module-manifest.module-spec';
	}

	#type: 'export' | 'manifest';

	/**
	 * Which declaration originated the module: an entry of the package exports, or a module manifest
	 */
	get type() {
		return this.#type;
	}

	#subpath?: string;

	/**
	 * The subpath the module publishes in its package, such as `./message` or `.`
	 */
	get subpath() {
		return this.#subpath ? this.#subpath : (<IManifestModuleSpec>this.#values)?.subpath;
	}

	#path?: string;

	/**
	 * The directory of the module, relative to the package directory
	 */
	get path() {
		return this.#path;
	}

	/**
	 * The entry point of the module, relative to its directory, such as `index.ts`. Its exports and
	 * re-exports are the public API; exports of the other sources of the module remain internal.
	 */
	get entry(): string | undefined {
		return (<IModuleSpecValues>this.#values)?.entry;
	}

	#language?: string;
	get language() {
		return this.#language;
	}

	#bundler: string;

	/**
	 * The name, in the bundlers registry of the package, of the bundler that compiles this module
	 */
	get bundler() {
		return this.#bundler;
	}

	#values: ModuleSpecType;

	/**
	 * The configuration the bundler receives, which includes the entry point
	 */
	get values() {
		return this.#values;
	}

	/**
	 * @param info Which declaration originated the module, with the data that identifies it
	 * @param bundler The bundler that compiles it: the one its manifest selects, the default bundler of the
	 * package, or the exports bundler when the entry is not a source file
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

	/**
	 * Reads an entry of the package exports as the entry point of a Beyond public module.
	 *
	 * The target of the entry is a source file, which locates both the module and the file that defines its
	 * public API: `"./message": "./message/index.ts"` publishes the module of the `message` directory, whose
	 * API is what `index.ts` exports.
	 *
	 * @returns The directory of the module and its entry point, or undefined when the target is not a source
	 * file and the entry is therefore not a Beyond module
	 */
	static entry(target: unknown): { path: string; entry: string } | undefined {
		if (typeof target !== 'string' || !target.startsWith('./')) return;
		if (!SOURCE_EXTNAMES.includes(posix.extname(target))) return;

		// An entry cannot take its sources from outside the package
		const normalized = posix.normalize(target);
		if (normalized.startsWith('..')) return;

		const path = posix.dirname(normalized).replace(/^\.\/?/, '');
		const entry = posix.basename(normalized);
		return { path, entry };
	}

	/**
	 * Applies the combined declarations of the module.
	 *
	 * @param values The configuration of the bundler, including the entry point
	 * @param options The bundler selected for the module and, for a module declared by the package exports,
	 * the directory its entry point locates
	 */
	update(values: ModuleSpecType, options?: { bundler?: string; path?: string }) {
		values = values || {};

		const bundler = options?.bundler ?? this.#bundler;
		const path = this.#type === 'export' ? options?.path : this.#path;

		const changed = !equal(values, this.#values) || bundler !== this.#bundler || path !== this.#path;
		if (!changed) return;

		this.#values = values;
		this.#bundler = bundler;
		this.#path = path;
		this._invalidate();
	}
}
