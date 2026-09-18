import type { IDiagnostic, IConditions } from '@beyond-js/packages/types';

export /*bundle*/ interface IArtifactsOptions {
	/**
	 * The directory where the artifacts, their source maps, their updates and the import map are written.
	 * It is created when it does not exist; its previous content is not removed.
	 */
	path: string;

	/**
	 * The conditions that select which conditional of each public module is written, for example
	 * `{platform: 'node'}`. A module that does not declare them is reported as CONDITIONAL_NOT_FOUND.
	 */
	conditions: IConditions;
}

/**
 * Where one public bare specifier required by an artifact is resolved from
 */
export /*bundle*/ interface IArtifactDependency {
	/**
	 * The bare specifier as it appears in the artifact, which packaging never rewrites
	 */
	specifier: string;

	/**
	 * - `workspace`: a public module of a package of this workspace, provided by its own artifact
	 * - `runtime`: the Beyond runtime
	 * - `builtin`: a Node builtin module
	 * - `external`: an installed package, resolved by the environment that executes the artifact
	 */
	source: 'workspace' | 'runtime' | 'builtin' | 'external';

	/**
	 * The versioned identity of the required public module, when the source is `workspace`
	 */
	vspecifier?: string;

	/**
	 * The version range that the dependent package declares for the required package, when the source is
	 * `workspace` and the packages differ. A public module of the same package has no declared range.
	 */
	range?: string;
}

/**
 * One written public module artifact, with the metadata a consumer or a development service needs to
 * identify it, resolve its dependencies and detect what changed between builds
 */
export /*bundle*/ interface IArtifact {
	/**
	 * The public specifier of the module, for example `@suite/shared/message`
	 */
	specifier: string;

	/**
	 * The versioned identity the artifact registers in the runtime, for example `@suite/shared@0.1.0/message`
	 */
	vspecifier: string;

	package: string;
	version: string;

	/**
	 * The module subpath inside its package, for example `./message`
	 */
	subpath: string;

	conditions: IConditions;

	/**
	 * The artifact file and its update file, relative to the artifacts directory
	 */
	file: string;
	patch?: string;

	/**
	 * The hash of the artifact code. It changes when the emitted code changes, so consumers and caches
	 * detect a rebuilt artifact without comparing its content.
	 */
	hash: string;

	/**
	 * The public API of the module: the names exported by its entry point
	 */
	exports: string[];

	/**
	 * The internal modules composing the artifact, with the content hash the runtime compares to decide
	 * which creators an update replaces
	 */
	ims: { id: string; hash: number }[];

	/**
	 * Which mode produced the artifact. A `creators` artifact registers its internal modules in the Beyond
	 * runtime and has an update file; a `packaged` one is a self-contained ES module, with no internal
	 * modules and no update file. Consumers must not assume one from the other.
	 */
	composition: 'creators' | 'packaged';

	/**
	 * Public modules a packaged artifact re-exports with `export *`; their names are not in `exports`
	 */
	stars?: string[];

	/**
	 * The source files bundled into a packaged artifact, relative to its module directory
	 */
	inputs?: string[];

	/**
	 * The compiler that produced a packaged artifact, as its bundler resolved it
	 */
	compiler?: { specifier: string; version: string; location?: string; assigned: boolean; provenance?: Record<string, unknown> };

	dependencies: IArtifactDependency[];
}

export /*bundle*/ interface IArtifactsReport {
	/**
	 * The artifacts directory, as configured
	 */
	path: string;

	conditions: IConditions;

	/**
	 * The artifacts that were written. A module whose compilation failed is absent, and reported in errors.
	 */
	artifacts: IArtifact[];

	errors: IDiagnostic[];
	warnings: IDiagnostic[];

	/**
	 * The import map file, relative to `path`
	 */
	importmap: string;
}
