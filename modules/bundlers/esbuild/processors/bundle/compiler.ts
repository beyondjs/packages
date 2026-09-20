import type { IDiagnostic } from '@beyond-js/packages/types';
import { createRequire } from 'module';
import { fileURLToPath, pathToFileURL } from 'url';
import { dirname, isAbsolute, join, resolve } from 'path';
import { existsSync, readFileSync } from 'fs';

/**
 * Which compiler produced an artifact. `assigned` is a capability only the Beyond fork of esbuild has, so
 * it tells the fork from an upstream build that reports the same version.
 */
export /*bundle*/ interface ICompilerIdentity {
	specifier: string;
	version: string;
	location?: string;
	assigned: boolean;
	provenance?: Record<string, unknown>;
}

/**
 * The compiler a packaged module is built with, selected explicitly in the settings of the bundler:
 *
 * "bundlers": { "esbuild": { "specifier": "…/bundlers/esbuild", "processors": { "bundle": { "compiler": "…" } } } }
 *
 * The value names one compiler, in one of these forms:
 *
 * - an installed package name or a `file:` URL, which the loader of the running process resolves;
 * - a path starting with `./` or `../`, resolved against the root of the package that declares it, so a
 *   manifest can name a build that sits at a known place beside it;
 * - `env:NAME`, the value of that environment variable, which must be an absolute path, a `file:` URL or a
 *   package name. It lets one manifest be used where checkouts are placed differently.
 *
 * There is no default and no fallback, because an artifact must be able to say which compiler built it: a
 * module that selects none, or names a variable that is not set, reports it. The identity keeps the value as
 * declared next to the location it resolved to.
 */
export /*bundle*/ class Compiler {
	static #loaded: Map<string, Promise<Compiler>> = new Map();

	#api: typeof import('esbuild');
	get api() {
		return this.#api;
	}

	#identity: ICompilerIdentity;
	get identity() {
		return this.#identity;
	}

	#error?: IDiagnostic;
	get error() {
		return this.#error;
	}

	/**
	 * @param declared The value of the setting
	 * @param root The root of the package that declares it, which relative values are resolved against
	 */
	static load(declared: string, root: string): Promise<Compiler> {
		// A relative value names a different file in each package, and a variable can change between runs
		const variable = typeof declared === 'string' && declared.startsWith('env:') ? process.env[declared.slice(4)] : '';
		const key = JSON.stringify([declared, root, variable]);

		!this.#loaded.has(key) && this.#loaded.set(key, new Compiler().#load(declared, root));
		return this.#loaded.get(key);
	}

	/**
	 * The specifier to import for a declared value, or the reason why it selects nothing
	 */
	#select(declared: string, root: string): string | undefined {
		const none = (message: string) => void (this.#error = { code: 'COMPILER_NOT_SELECTED', message });

		if (!declared || typeof declared !== 'string') {
			return none('The esbuild bundler requires "processors.bundle.compiler" in its package settings');
		}
		if (/^\.\.?\//.test(declared)) return pathToFileURL(resolve(root, declared)).href;
		if (!declared.startsWith('env:')) return declared;

		const name = declared.slice(4);
		const value = process.env[name];
		if (!value) return none(`The compiler is selected as "${declared}", but the environment variable "${name}" is not set`);
		if (isAbsolute(value)) return pathToFileURL(value).href;
		if (/^\.\.?\//.test(value) || value.startsWith('env:')) {
			return none(`The environment variable "${name}" must hold an absolute path, a "file:" URL or a package name`);
		}
		return value;
	}

	async #load(declared: string, root: string): Promise<this> {
		const specifier = this.#select(declared, root);
		if (!specifier) return this;

		try {
			const imported = await import(specifier);
			this.#api = imported.default?.build ? imported.default : imported;
			if (typeof this.#api?.build !== 'function') throw new Error('It does not expose "build"');
		} catch (exc) {
			this.#error = { code: 'COMPILER_IMPORT_ERROR', message: `Compiler "${declared}" cannot be used: ${exc.message}` };
			return this;
		}

		// Upstream rejects the option; the fork accepts it. Nothing is compiled with it here.
		const assigned = await this.#api
			.transform('', <any>{ format: 'cjs', cjsExports: 'getters', logLevel: 'silent' })
			.then(() => true)
			.catch(() => false);

		const location = this.#locate(specifier);
		// The value as declared, next to where it resolved to
		this.#identity = { specifier: declared, version: this.#api.version, location, assigned, provenance: this.#provenance(location) };
		return this;
	}

	#locate(specifier: string): string | undefined {
		try {
			if (specifier.startsWith('file:')) return fileURLToPath(specifier);
			return createRequire(join(process.cwd(), 'package.json')).resolve(specifier);
		} catch {
			return void 0;
		}
	}

	// A fork build describes itself in the file that the `beyond` field of its manifest names
	#provenance(location?: string): Record<string, unknown> | undefined {
		for (let directory = location && dirname(location); directory && directory !== dirname(directory); directory = dirname(directory)) {
			const manifest = join(directory, 'package.json');
			if (!existsSync(manifest)) continue;
			try {
				const { beyond } = JSON.parse(readFileSync(manifest, 'utf8'));
				return typeof beyond === 'string' ? JSON.parse(readFileSync(join(directory, beyond), 'utf8')) : void 0;
			} catch {
				return void 0;
			}
		}
	}
}
