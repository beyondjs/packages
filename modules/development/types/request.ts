import { builtinModules } from 'module';
import { DevelopmentError } from '../error';

/**
 * A package name and the subpath of a public module, in the spelling of package manifests (`.` or `./name`)
 */
export interface ISpecified {
	name: string;
	subpath: string;
	version?: string;
}

/**
 * A request of type browsing: `GET /types?specifier=&importer=`.
 *
 * `specifier` is the public specifier whose declaration is read: a bare specifier (`react`, `@scope/name/sub`), or a
 * versioned one for a module of the workspace (`@scope/name@1.0.0/sub`). `importer` is where a type check resolves it
 * from: a public module or package of the workspace (bare or versioned), or `.` for the root of the workspace, which
 * is the default; each further `> <package>` names a package that the previous one imports, so a reference read in
 * an installed package's declaration is resolved from that package, as the type check resolves it
 * (`@scope/app@1.0.0/main > react-dom`).
 *
 * A path is not a specifier (`400 TYPES_REQUEST_INVALID`). A Node builtin (`node:fs`) and a Git or archive address
 * (`github:…`, `git+https:…`, an archive URL) name nothing a package publishes by name (`422 TYPES_UNSUPPORTED`).
 */
export class TypesRequest {
	static LENGTH = 512;
	static CHAIN = 16;

	static #VERSIONED = /^(@[^/@\s]+\/[^/@\s]+|[^/@\s.][^/@\s]*)@([^/@\s]+)(?:\/(\S+))?$/;
	static #BARE = /^(@[^/@\s]+\/[^/@\s]+|[^/@\s.][^/@\s]*)(?:\/(\S+))?$/;
	static #SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;
	static #ARCHIVES = /^(git\+|git:|github:|gitlab:|bitbucket:|https?:|file:)/i;

	#specifier: string;
	#specified: ISpecified;
	#importer: string | undefined;
	#chain: string[];

	/**
	 * The specifier as it was requested
	 */
	get specifier() {
		return this.#specifier;
	}

	/**
	 * Its package, subpath and, for a versioned specifier, version
	 */
	get specified(): ISpecified {
		return this.#specified;
	}

	/**
	 * The importer as it was requested, undefined when none was
	 */
	get importer() {
		return this.#importer;
	}

	/**
	 * The elements of the importer: the context first (`.` when none was requested), then the packages each one imports
	 */
	get chain(): string[] {
		return this.#chain;
	}

	/**
	 * Whether the package a specifier names is a builtin module of Node, which `@types/node` declares ambiently
	 */
	get builtin(): boolean {
		return builtinModules.includes(this.#specified.name);
	}

	/**
	 * @param query The query of the request
	 * @throws DevelopmentError `400 TYPES_REQUEST_INVALID`, `422 TYPES_UNSUPPORTED`
	 */
	constructor(query: Record<string, unknown>) {
		const { specifier, importer } = query;
		if (typeof specifier !== 'string' || !specifier || specifier.length > TypesRequest.LENGTH) {
			throw TypesRequest.#invalid(`"specifier" is required: the public specifier of a module, at most ${TypesRequest.LENGTH} characters`);
		}
		this.#specifier = specifier;
		this.#specified = TypesRequest.parse(specifier);

		const given = typeof importer === 'string' ? importer : void 0;
		if (importer !== void 0 && (given === void 0 || !given.trim() || given.length > TypesRequest.LENGTH * 2)) {
			throw TypesRequest.#invalid('"importer" is a public module or package of the workspace, or ".", optionally followed by "> <package>" for each package it imports');
		}
		this.#importer = given;
		this.#chain = TypesRequest.#elements(given);
	}

	static #invalid(message: string): DevelopmentError {
		return new DevelopmentError('TYPES_REQUEST_INVALID', message, 400);
	}

	/**
	 * The package and subpath of a public specifier
	 *
	 * @throws DevelopmentError `400 TYPES_REQUEST_INVALID` for a path or a malformed specifier, `422 TYPES_UNSUPPORTED`
	 * for a builtin or a Git or archive address
	 */
	static parse(specifier: string): ISpecified {
		if (/^[./\\]/.test(specifier)) throw TypesRequest.#invalid(`"${specifier}" is a path: name the public specifier of a module`);
		if (specifier.startsWith('node:')) {
			throw new DevelopmentError('TYPES_UNSUPPORTED', `"${specifier}" is a builtin module of Node, which @types/node declares ambiently: this route reads the declarations of packages`, 422);
		}
		if (TypesRequest.#ARCHIVES.test(specifier)) {
			throw new DevelopmentError('TYPES_UNSUPPORTED', `"${specifier}" is a Git or archive address: this route reads the declarations of the packages a type check imports by name`, 422);
		}
		if (TypesRequest.#SCHEME.test(specifier)) throw TypesRequest.#invalid(`"${specifier}" is not a public specifier`);

		const versioned = TypesRequest.#VERSIONED.exec(specifier);
		const [, name, version, rest] = versioned ?? [];
		const bare = versioned ? void 0 : TypesRequest.#BARE.exec(specifier);
		const subpath = versioned ? rest : bare?.[2];
		const segments = subpath?.split('/') ?? [];
		if ((!versioned && !bare) || segments.some(segment => !segment || segment === '.' || segment === '..')) {
			throw TypesRequest.#invalid(`"${specifier}" is not a public specifier`);
		}
		return { name: versioned ? name : bare[1], subpath: subpath ? `./${subpath}` : '.', ...(versioned ? { version } : {}) };
	}

	/**
	 * The elements of an importer: its context and the packages after it
	 */
	static #elements(importer: string | undefined): string[] {
		if (importer === void 0) return ['.'];
		const elements = importer.split('>').map(element => element.trim());
		if (elements.length > TypesRequest.CHAIN || elements.some(element => !element)) {
			throw TypesRequest.#invalid(`"importer" has at most ${TypesRequest.CHAIN} elements separated by ">", none of them empty`);
		}
		const [context, ...packages] = elements;
		context !== '.' && TypesRequest.parse(context);
		packages.forEach(name => {
			const parsed = TypesRequest.parse(name);
			if (parsed.subpath !== '.' || parsed.version) throw TypesRequest.#invalid(`"${name}" in "importer" is not the name of a package`);
		});
		return elements;
	}
}
