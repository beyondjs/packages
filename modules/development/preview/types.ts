export /*bundle*/ interface IPreviewModule {
	specifier: string;

	/**
	 * `environment`: selected for development and served by this service, an installed package this environment
	 * compiles for browsers, or any node of an installed graph. `cdn`: every other module, at its exact version.
	 * `unresolved`: a module that no address could be given to, with the reason.
	 */
	source: 'environment' | 'cdn' | 'unresolved';
	version?: string;

	/**
	 * The versioned identity of a module served by this environment, which builds and the runtime name it by
	 */
	vspecifier?: string;
	url?: string;
	reason?: string;

	/**
	 * The address of the stylesheet of the module, when its sources produce one and it is served by this
	 * environment. The document links the stylesheets of the modules that are not widgets; a widget adopts
	 * its own sheets inside its shadow root.
	 */
	styles?: string;

	/**
	 * Whether the module declares a widget
	 */
	widget?: boolean;

	/**
	 * The stylesheets the sources of the module select by specifier (`pkg/sub.css`): the stylesheet of the
	 * public module `pkg/sub`, with its address and the versioned identity the runtime replaces it by. The
	 * document links those of the modules in its scope; a widget adopts them.
	 */
	stylesheets?: { specifier: string; vspecifier: string; url: string }[];

	/**
	 * Who holds the stylesheets of a module that has them: the document, when the entry reaches the module
	 * without crossing a widget, or the widgets that import it, which adopt them in their own roots
	 */
	scope?: 'document' | 'widget';
}

/**
 * A module in development as the development runtime needs to know it to apply its updates
 */
export /*bundle*/ interface IPreviewUpdatable {
	package: string;
	vspecifier: string;
	path: string;
}

export /*bundle*/ interface IPreviewDiagnostic {
	code: string;
	message: string;
}

/**
 * One output of a public module for one platform. `source` is where it comes from: a workspace module in
 * development served by this environment (`workspace`), something else this environment serves or its Node consumer
 * resolves itself (`environment`: a package the toolchain supplies, an installed package), the CDN (`cdn`), or no
 * address with the reason (`unresolved`). `built` and `failed` are this environment's builds, with the
 * hash of the output when it was built; `prepared`, `missing` and `unavailable` are what the CDN answered for its
 * address (`digest` from its entity tag); `unknown` was not measured.
 */
export /*bundle*/ interface ICompositionOutput {
	source: 'workspace' | 'environment' | 'cdn' | 'unresolved';
	state: 'built' | 'failed' | 'prepared' | 'missing' | 'unavailable' | 'unknown';
	address?: string;
	hash?: string;
	digest?: string;
	reason?: string;

	/**
	 * The Node builtins the output imports, which no package provides
	 */
	builtins?: string[];
}

/**
 * A public module of the composition, by its identity: `<package id>/<subpath>`, or the package id for the root
 */
export /*bundle*/ interface ICompositionModule {
	id: string;
	specifier: string;
	package: string;
	subpath: string;
	vspecifier?: string;
	widget?: boolean;

	/**
	 * Whether the preview page of the entry loads it
	 */
	loaded: boolean;

	/**
	 * The platforms it is described for, each with its output
	 */
	platforms: ('web' | 'node')[];
	outputs: { web?: ICompositionOutput; node?: ICompositionOutput };
}

/**
 * A package of the composition: `<name>@<version>`, prefixed with its registry id when that is not npm or the
 * workspace. `source` is where its modules' outputs come from when they agree, and `mixed` when they do not (a
 * selection of single modules, or a module the page loads from the CDN and Node from this environment).
 */
export /*bundle*/ interface ICompositionPackage {
	id: string;
	name: string;
	version?: string;
	source: 'workspace' | 'environment' | 'cdn' | 'unresolved' | 'mixed';
	reason?: string;
	provider: 'workspace' | 'toolchain' | 'installation' | 'store' | 'registry';
	registry?: string;

	/**
	 * What its manifest declares, when this environment can read it, with the versions of each name that its
	 * modules reach in this composition
	 */
	dependencies?: { name: string; range: string; kind: 'dependencies' | 'peerDependencies' | 'optionalDependencies' | 'devDependencies'; resolved: string[] }[];
}

/**
 * A public dependency of one module on another, for one platform. `runtime` is the runtime its artifact is
 * assembled against, which its sources do not import.
 */
export /*bundle*/ interface ICompositionEdge {
	from: string;
	to: string;
	specifier: string;
	platform: 'web' | 'node';
	runtime?: boolean;
}

/**
 * The composition of the application of the served workspace (`GET /preview/composition.json`): its packages, its
 * public modules with their outputs per platform, and the public dependencies between modules, kept apart. The files
 * of a module are not part of it: they are the file contract's. The page of `entry` decides the web outputs; every
 * public module of the workspace that declares Node is described with its Node output.
 */
export /*bundle*/ interface ICompositionDocument {
	protocol: 'beyond-dev-composition/1';
	entry: { specifier: string; vspecifier: string };
	selection: { explicit: boolean; externals: 'environment' | 'cdn'; reason?: string };
	cdn: { origin?: string; reason?: string };
	packages: ICompositionPackage[];
	modules: ICompositionModule[];
	edges: ICompositionEdge[];
	diagnostics: IPreviewDiagnostic[];
}
