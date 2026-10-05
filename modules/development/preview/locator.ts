import type { IPublishedModule } from '../builds';

/**
 * Who imports a module: the public module of the workspace the walk came from, the package prefix of its address
 * (its scope in the import map) and what decides what it imports. On the disk that is the directory its installed
 * packages are found from; in an installed graph it is its instance and the instances that reached it.
 */
export interface IImporter {
	module: IPublishedModule;
	prefix?: string;
	path?: string;

	/**
	 * The instance of the importer, in an installed graph
	 */
	key?: string;

	/**
	 * The instances that reached the importer, nearest first, which decide the peers it binds
	 */
	chain?: string[];

	/**
	 * Whether the importer is an instance that already reached itself: what it imports is not walked again
	 */
	cycle?: boolean;
}

/**
 * Where a bare specifier that an importer imports comes from: a public module of the workspace, or a package
 * the workspace does not contain, at the exact version the importer resolves it to
 */
export interface ILocated {
	/**
	 * The public module of the workspace the specifier names, when it is one
	 */
	local?: IPublishedModule;

	name: string;
	subpath: string;
	version?: string;

	/**
	 * Why no version is known, and the code of its diagnostic
	 */
	reason?: string;
	code?: string;

	/**
	 * The registry it is addressed under, or why it has no registry address
	 */
	registry?: string;
	unsupported?: string;

	/**
	 * Whether this environment delivers it; the CDN does otherwise
	 */
	served?: boolean;

	/**
	 * Its instance and where it is, in an installed graph
	 */
	key?: string;
	location?: string;
}

/**
 * How the graph of a preview finds what each module imports
 */
export interface ILocator {
	/**
	 * Whether every module the walk reaches is a node of an installed graph, which this environment serves
	 * whatever the selection says, and whose instances are walked again in each context that reaches them
	 */
	readonly installed: boolean;

	/**
	 * @param runtime Whether the specifier is the runtime of the artifact that imports it
	 * @param vspecifier The versioned identity the host gave a dependency it classified as a module of the workspace
	 * @param published The public modules of the workspace
	 */
	locate(specifier: string, importer: IImporter, runtime: boolean, vspecifier: string | undefined, published: IPublishedModule[]): Promise<ILocated>;

	/**
	 * The importer of a public module of the workspace, reached from an importer or as a root of the walk
	 *
	 * @param url The address of the module, whose package prefix is its scope
	 */
	local(module: IPublishedModule, url: string | undefined, importer?: IImporter): IImporter;

	/**
	 * The importer of what a located package imports
	 */
	nested(located: ILocated, importer: IImporter, url: string): Promise<IImporter>;

	/**
	 * Whether a package an importer can import publishes a public subpath, which is asked before the coordinator of
	 * a runtime is addressed
	 */
	exports(specifier: string, importer: IImporter, published: IPublishedModule[]): Promise<boolean>;

	/**
	 * The public module of the workspace that is the development coordinator of a runtime of the page
	 * (`<runtime>/main`), when the workspace contains it
	 */
	coordinator(specifier: string, published: IPublishedModule[]): IPublishedModule | undefined;
}
