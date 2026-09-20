import type { Paths } from './paths';
import type { Files } from './files';
import type { Budget } from './budget';
import type { Resolver } from './resolver';
import * as ts from 'typescript';
import { posix } from 'path';

/**
 * The parsed default libraries, which are the same for every check of a process that uses the same options
 */
const libraries: Map<string, ts.SourceFile> = new Map();

/**
 * What the compiler sees of the host while it builds the program of one check.
 *
 * Files come from the sources supplied in memory and from the locations the check may read, imports are
 * resolved by the resolver of the check, nothing is written, and every file the compiler requests is
 * charged to the budget, which is where a check that grows beyond its limits is stopped.
 */
export class Host implements ts.CompilerHost {
	#options: ts.CompilerOptions;
	#paths: Paths;
	#files: Files;
	#budget: Budget;
	#resolver: Resolver;
	#sources: Set<string>;
	#library: string;
	#key: string;

	/**
	 * @param sources The sources of the module, which the budget already counted when they were found
	 */
	constructor(
		options: ts.CompilerOptions,
		paths: Paths,
		files: Files,
		budget: Budget,
		resolver: Resolver,
		sources: string[]
	) {
		this.#options = options;
		this.#paths = paths;
		this.#files = files;
		this.#budget = budget;
		this.#resolver = resolver;
		this.#sources = new Set(sources);

		this.#library = posix.dirname(ts.getDefaultLibFilePath(options).replace(/\\/g, '/'));
		paths.allow(this.#library, '<typescript>');

		// A parsed library is only shared between checks whose options agree; where files are found is irrelevant
		const located = [
			'typeRoots',
			'types',
			'configFilePath',
			'pathsBasePath',
			'paths',
			'baseUrl',
			'customConditions'
		];
		const relevant = Object.entries(options).filter(([name]) => !located.includes(name));
		this.#key = JSON.stringify([ts.version, relevant.sort(([a], [b]) => (a < b ? -1 : 1))]);
	}

	/**
	 * Whether a file is one of the TypeScript default libraries
	 */
	library(file: string): boolean {
		return file.startsWith(`${this.#library}/`);
	}

	getSourceFile(file: string, version: ts.ScriptTarget | ts.CreateSourceFileOptions): ts.SourceFile | undefined {
		this.#budget.verify();

		const key = `${this.#key}|${file}`;
		if (libraries.has(key)) return libraries.get(key);

		const content = this.#files.read(file);
		if (content === void 0) return;

		const library = this.library(file);
		!library && !this.#sources.has(file) && this.#budget.count();

		const source = ts.createSourceFile(file, content, version);
		library && libraries.set(key, source);
		return source;
	}

	resolveModuleNameLiterals(
		literals: readonly ts.StringLiteralLike[],
		containing: string
	): ts.ResolvedModuleWithFailedLookupLocations[] {
		return literals.map(({ text }) => ({
			resolvedModule: this.#resolver.module(text, containing, this.#options, this)
		}));
	}

	resolveTypeReferenceDirectiveReferences<T extends ts.FileReference | string>(
		references: readonly T[],
		containing: string
	): ts.ResolvedTypeReferenceDirectiveWithFailedLookupLocations[] {
		return references.map(reference => {
			const name = typeof reference === 'string' ? reference : reference.fileName;
			const file = this.#resolver.types(name);
			if (!file) return ts.resolveTypeReferenceDirective(name, containing, this.#options, this);

			const resolved = { primary: true, resolvedFileName: file, isExternalLibraryImport: true };
			return { resolvedTypeReferenceDirective: resolved };
		});
	}

	getDefaultLibFileName(options: ts.CompilerOptions): string {
		return ts.getDefaultLibFilePath(options).replace(/\\/g, '/');
	}

	getDefaultLibLocation(): string {
		return this.#library;
	}

	getCurrentDirectory(): string {
		return this.#paths.root;
	}

	getCanonicalFileName(file: string): string {
		return file;
	}

	useCaseSensitiveFileNames(): boolean {
		return true;
	}

	getNewLine(): string {
		return '\n';
	}

	fileExists(file: string): boolean {
		return this.#files.exists(file);
	}

	readFile(file: string): string | undefined {
		return this.#files.read(file);
	}

	directoryExists(directory: string): boolean {
		return this.#files.directory(directory);
	}

	getDirectories(directory: string): string[] {
		return this.#files.directories(directory);
	}

	/**
	 * A check emits nothing
	 */
	writeFile(): void {}
}
