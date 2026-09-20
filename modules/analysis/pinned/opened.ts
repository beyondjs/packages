import type { IDiagnostic } from '@beyond-js/packages/types';
import { type IPublication, type IDistributedModule } from '@beyond-js/packages/publication';
import type { IAnalysisConditions, IGraphNode } from '../types';

/**
 * One public module of an opened package, with what is needed to trace it and to compile it
 */
export /*bundle*/ interface IPublicModule {
	subpath: string;
	kind: 'module' | 'style';

	/**
	 * The entry point file and the directory its inputs are named from. A distributed module has none:
	 * it is never compiled.
	 */
	entry?: string;
	directory?: string;

	/**
	 * The generated entry point that adapts a CommonJS public API to named exports
	 */
	facade?: string;

	/**
	 * The assets the module declares, as paths relative to the package root
	 */
	assets: string[];

	/**
	 * The public modules the module declares for its indeterminate dynamic imports
	 */
	dynamic: string[];

	/**
	 * Resolution conditions and `process.env.NODE_ENV` of an ordinary npm package
	 */
	conditions?: string[];
	mode?: string;

	distributed?: IDistributedModule;
}

/**
 * A package version of the pinned graph, opened from its extracted root in the form its manifest declares.
 *
 * Each form answers the same two questions: which public module a subpath is for the requested conditions,
 * and which files are the entry points of the other public modules, so they are referenced and never
 * bundled twice.
 */
export /*bundle*/ abstract class Opened {
	#key: string;
	get key() {
		return this.#key;
	}

	#root: string;
	get root() {
		return this.#root;
	}

	#node: IGraphNode;
	get node() {
		return this.#node;
	}

	#manifest: Record<string, any>;
	get manifest() {
		return this.#manifest;
	}

	#publication: IPublication;
	get publication() {
		return this.#publication;
	}

	#integrity?: string;

	/**
	 * The integrity of the package: the one of its node, or the one its fetch verified
	 */
	get integrity() {
		return this.#integrity;
	}

	get form() {
		return this.#publication.form;
	}

	get name(): string {
		return this.#node.name;
	}

	get version(): string {
		return this.#node.version;
	}

	constructor(key: string, root: string, node: IGraphNode, manifest: Record<string, any>, publication: IPublication, integrity?: string) {
		this.#integrity = node.integrity ?? integrity;
		this.#key = key;
		this.#root = root;
		this.#node = node;
		this.#manifest = manifest;
		this.#publication = publication;
	}

	/**
	 * The assets the package declares for all its modules (`beyond.assets`), relative to its root
	 */
	get assets(): string[] {
		const declared = this.#manifest.beyond?.assets;
		return declared instanceof Array ? declared.filter(path => typeof path === 'string') : [];
	}

	abstract module(subpath: string, conditions: IAnalysisConditions): Promise<{ module?: IPublicModule; diagnostics: IDiagnostic[] }>;

	/**
	 * The entry point file of every public module but one, with its specifier
	 */
	abstract entries(conditions: IAnalysisConditions, except: string): Promise<Map<string, string>>;

	/**
	 * What the package already lists about one of its static files, which spares reading it. Only a
	 * distribution does.
	 */
	async listed(path: string): Promise<{ media: string; digest: string; bytes: number } | undefined> {
		void path;
		return void 0;
	}

	destroy(): void {}
}
