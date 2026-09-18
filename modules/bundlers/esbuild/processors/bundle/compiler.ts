import type { IDiagnostic } from '@beyond-js/packages/types';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync, readFileSync } from 'fs';

/**
 * Which compiler produced an artifact. `assigned` is a capability only the Beyond fork of esbuild has, so
 * it tells the fork from an upstream build that reports the same version.
 */
export interface ICompilerIdentity {
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
 * The value is a module specifier that the loader of the running process resolves: an installed package
 * name or a `file:` URL. There is no default and no fallback, because an artifact must be able to say which
 * compiler built it; a module that does not select one reports it.
 */
export class Compiler {
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

	static load(specifier: string): Promise<Compiler> {
		!this.#loaded.has(specifier) && this.#loaded.set(specifier, new Compiler().#load(specifier));
		return this.#loaded.get(specifier);
	}

	async #load(specifier: string): Promise<this> {
		if (!specifier || typeof specifier !== 'string') {
			const message = 'The esbuild bundler requires "processors.bundle.compiler" in its package settings';
			this.#error = { code: 'COMPILER_NOT_SELECTED', message };
			return this;
		}

		try {
			const imported = await import(specifier);
			this.#api = imported.default?.build ? imported.default : imported;
			if (typeof this.#api?.build !== 'function') throw new Error('It does not expose "build"');
		} catch (exc) {
			this.#error = { code: 'COMPILER_IMPORT_ERROR', message: `Compiler "${specifier}" cannot be used: ${exc.message}` };
			return this;
		}

		// Upstream rejects the option; the fork accepts it. Nothing is compiled with it here.
		const assigned = await this.#api
			.transform('', <any>{ format: 'cjs', cjsExports: 'getters', logLevel: 'silent' })
			.then(() => true)
			.catch(() => false);

		const location = this.#locate(specifier);
		this.#identity = { specifier, version: this.#api.version, location, assigned, provenance: this.#provenance(location) };
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
