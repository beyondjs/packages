import { promises as fs } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

/**
 * A package that the workspace does not contain, at the version a preview asks the CDN for
 */
export interface IExternal {
	name: string;
	subpath: string;
	version?: string;

	/**
	 * Why no exact version is known
	 */
	reason?: string;
}

/**
 * The exact version of the packages that a workspace imports and does not contain.
 *
 * A version is resolved, never chosen: it is the one installed for the importing package, found as Node
 * finds it, or the declared dependency when it is an exact version. The runtime that the artifacts import is
 * the one installed with the service, because a composed artifact is assembled against it and a project does
 * not declare it. A range that nothing resolved stays unresolved and is reported: asking a CDN for a guessed
 * version would preview code that the project does not depend on.
 */
export class Externals {
	static EXACT = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/;

	#runtime: string;

	/**
	 * @param runtime The `package.json` URL of the installation that provides the runtime, as the session of
	 * the service describes it
	 */
	constructor(runtime?: string) {
		this.#runtime = runtime?.startsWith('file:') ? dirname(fileURLToPath(runtime)) : void 0;
	}

	/**
	 * Splits a public specifier into the package name and the subpath in the spelling of package manifests
	 */
	static parse(specifier: string): { name: string; subpath: string } {
		const segments = specifier.split('/');
		const name = segments.splice(0, specifier.startsWith('@') ? 2 : 1).join('/');
		return { name, subpath: segments.length ? `./${segments.join('/')}` : '.' };
	}

	async #json(file: string): Promise<Record<string, any> | undefined> {
		try {
			return JSON.parse(await fs.readFile(file, 'utf8'));
		} catch {
			return void 0;
		}
	}

	async #manifest(name: string, from: string): Promise<Record<string, any> | undefined> {
		for (let directory = from; ; directory = dirname(directory)) {
			const manifest = await this.#json(join(directory, 'node_modules', ...name.split('/'), 'package.json'));
			if (typeof manifest?.version === 'string') return manifest;
			if (dirname(directory) === directory) return;
		}
	}

	async #installed(name: string, from: string): Promise<string | undefined> {
		return (await this.#manifest(name, from))?.version;
	}

	/**
	 * Whether the installed runtime package exports a public module. Only an installation says so: a
	 * declared version tells nothing about what the package exports, and a runtime without the module is
	 * not asked for it.
	 *
	 * @param specifier A public specifier of the runtime package, such as its development coordinator
	 * @param importer The directory of the package whose artifact imports the runtime
	 */
	async exports(specifier: string, importer: string | undefined): Promise<boolean> {
		const { name, subpath } = Externals.parse(specifier);
		const manifest = (importer && (await this.#manifest(name, importer))) ?? (this.#runtime ? await this.#manifest(name, this.#runtime) : void 0);
		const exports = manifest?.exports;
		return !!exports && typeof exports === 'object' && Object.prototype.hasOwnProperty.call(exports, subpath);
	}

	/**
	 * @param specifier The public specifier that an artifact imports
	 * @param importer The directory of the package that imports it
	 * @param runtime Whether the specifier is the runtime of the artifact
	 */
	async resolve(specifier: string, importer: string | undefined, runtime?: boolean): Promise<IExternal> {
		void runtime;
		const { name, subpath } = Externals.parse(specifier);

		const manifest = importer ? await this.#json(join(importer, 'package.json')) : void 0;
		const declared = { ...manifest?.devDependencies, ...manifest?.peerDependencies, ...manifest?.dependencies }[name];

		// What the package does not install may be installed with the service: the runtime, and the libraries
		// the toolchain supplies with its Widgets adapters
		const installed = (importer && (await this.#installed(name, importer))) ?? (this.#runtime ? await this.#installed(name, this.#runtime) : void 0);
		const version = installed ?? (typeof declared === 'string' && Externals.EXACT.test(declared) ? declared : void 0);
		if (version && Externals.EXACT.test(version)) return { name, subpath, version };

		const reason = declared
			? `"${name}" is declared as "${declared}" and is not installed, so its exact version is unknown`
			: `"${name}" is neither installed nor declared by the package that imports it`;
		return { name, subpath, reason };
	}
}
