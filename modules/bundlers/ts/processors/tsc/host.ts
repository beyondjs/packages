import * as ts from 'typescript';
import { isAbsolute, join } from 'path';
import type { Graph } from './graph';

/**
 * The extensions of framework components, whose declarations are synthesized: a component is a default
 * export the program cannot type from the source, and the framework compiler checks the component itself
 */
const COMPONENTS = ['.vue', '.svelte'];

/**
 * The compiler host of a module program.
 *
 * It serves the files the program cannot read from disk: the declarations of the public modules the
 * sources import, held in memory under a virtual root, and the declaration of every framework component
 * imported by a relative path. Everything else is read as the TypeScript host reads it. A bare import of
 * a public module of the workspace resolves to nothing on disk: the ambient declaration of that module,
 * included in the program, answers it. Other bare imports are resolved from the module, then from the
 * fallback directory of the installation. With the installed graph of the workspace, every bare import and
 * type reference is resolved through the edges of the node that holds the importing file, and nothing else.
 */
export class Host {
	static VIRTUAL = '/beyond/types/';

	#host: ts.CompilerHost;
	#options: ts.CompilerOptions;
	#virtual: Map<string, string>;
	#fallback: string;
	#published: (specifier: string) => boolean;
	#graph: Graph | undefined;

	get compiler(): ts.CompilerHost {
		return this.#host;
	}

	/**
	 * @param virtual The in-memory files, by absolute virtual path
	 * @param published Whether a bare specifier is a public module of the workspace
	 * @param graph The installed graph of the workspace, which replaces every other resolution of a bare
	 * specifier or a type reference
	 */
	constructor(options: ts.CompilerOptions, directory: string, fallback: string, virtual: Map<string, string>, published: (specifier: string) => boolean, graph?: Graph) {
		this.#options = options;
		this.#virtual = virtual;
		this.#fallback = fallback;
		this.#published = published;
		this.#graph = graph;

		const host = ts.createCompilerHost(options, true);
		const original = { fileExists: host.fileExists, readFile: host.readFile, getSourceFile: host.getSourceFile };

		host.getCurrentDirectory = () => directory;
		host.fileExists = file => this.#virtual.has(file) || (this.#component(file) ? original.fileExists.call(host, file.slice(0, -'.d.ts'.length)) : original.fileExists.call(host, file));
		host.readFile = file => {
			if (this.#virtual.has(file)) return this.#virtual.get(file);
			if (this.#component(file)) return Host.stub();
			return original.readFile.call(host, file);
		};
		host.getSourceFile = (file, language, onError, shouldCreate) => {
			const content = this.#virtual.has(file) ? this.#virtual.get(file) : this.#component(file) ? Host.stub() : void 0;
			if (content !== void 0) return ts.createSourceFile(file, content, language, true);
			return original.getSourceFile.call(host, file, language, onError, shouldCreate);
		};
		host.writeFile = () => void 0;
		host.resolveModuleNameLiterals = (literals, containing, redirected, options) =>
			literals.map(literal => this.#resolve(literal.text, containing, options));
		if (graph) {
			host.resolveTypeReferenceDirectiveReferences = (references, containing, redirected, options) =>
				references.map(reference => graph.reference(typeof reference === 'string' ? reference : reference.fileName, containing, options));
		}

		this.#host = host;
	}

	/**
	 * Whether a file is the synthesized declaration of a framework component (`view.vue.d.ts`)
	 */
	#component(file: string): boolean {
		return COMPONENTS.some(extension => file.endsWith(`${extension}.d.ts`));
	}

	/**
	 * The declaration of a framework component: a default export the program does not type
	 */
	static stub(): string {
		return 'declare const component: any;\nexport default component;\n';
	}

	#resolve(specifier: string, containing: string, options: ts.CompilerOptions): ts.ResolvedModuleWithFailedLookupLocations {
		const none: ts.ResolvedModuleWithFailedLookupLocations = { resolvedModule: void 0 };

		if (specifier.startsWith('.') && COMPONENTS.some(extension => specifier.endsWith(extension))) {
			const file = join(containing, '..', specifier).replace(/\\/g, '/') + '.d.ts';
			return { resolvedModule: { resolvedFileName: file, extension: ts.Extension.Dts, isExternalLibraryImport: false } };
		}

		// Through the installed graph, the edges of the node that holds the file decide every bare specifier,
		// whichever file imports it: a member is declared ambiently, an external package is read from its node
		const bare = !specifier.startsWith('.') && !isAbsolute(specifier);
		if (bare && this.#graph) return this.#graph.module(specifier, containing, options);

		// A public module of the workspace is declared ambiently by the program; nothing on disk answers it
		if (bare && this.#published(specifier)) return none;

		const resolved = ts.resolveModuleName(specifier, containing, options, this.#host);
		if (resolved.resolvedModule || !bare) return resolved;

		// Not installed for the package: the installation that runs Packages may supply it
		return ts.resolveModuleName(specifier, join(this.#fallback, 'noop.ts'), options, this.#host);
	}
}
