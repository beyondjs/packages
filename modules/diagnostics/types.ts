/**
 * The conditions the module is checked for. They select the custom conditions of package `exports` when
 * the types of a dependency are resolved; they do not change which sources are checked.
 */
export /*bundle*/ interface IDiagnosticsConditions {
	platform: string;
	environment?: 'development' | 'production';

	[key: string]: boolean | string | undefined;
}

/**
 * One public module, identified with plain data so that a caller without a live workspace, such as a worker
 * that extracted an npm package of Beyond sources, describes it the same way a workspace package is described.
 */
export /*bundle*/ interface IModuleInput {
	/**
	 * The name of the package that publishes the module, which also resolves imports of its own specifiers
	 */
	package: string;

	version?: string;

	/**
	 * The absolute directory of the package. It is the only absolute value of the description, and it is
	 * never part of a result: every reported file is relative to it.
	 */
	root: string;

	/**
	 * The subpath the module publishes, such as `./message` or `.`
	 */
	subpath: string;

	/**
	 * The entry point of the module, relative to the package, such as `message/index.ts`
	 */
	entry: string;

	/**
	 * The directory of the module, relative to the package. It defaults to the directory of the entry point.
	 */
	path?: string;

	/**
	 * The sources of the module, relative to the package. When omitted, they are every `.ts` and `.tsx` file
	 * under the module directory, which is what generation compiles.
	 */
	files?: string[];

	/**
	 * A configuration file relative to the package, or inline compiler options. When omitted, the
	 * `tsconfig.json` of the module directory applies, then the one of the package, then the defaults.
	 */
	tsconfig?: string | { compilerOptions: Record<string, unknown> };
}

/**
 * Contents supplied in memory instead of being read from the package directory
 */
export /*bundle*/ interface ISourcesInput {
	/**
	 * The content of each file, keyed by its path relative to the package. It takes precedence over the file
	 * of the same path in the package directory.
	 */
	files?: Record<string, string>;
}

/**
 * Where the types of the bare public dependencies of the module are found. Every value is an absolute
 * location of the host, used for reading only and never reported.
 */
export /*bundle*/ interface IDependenciesInput {
	/**
	 * The declaration file, or the source entry point, of a public module, keyed by its bare specifier
	 */
	declarations?: Record<string, string>;

	/**
	 * The directory of a package, keyed by its name, which is how a store of extracted packages is laid out.
	 * The file is selected through the `exports`, `types` and `main` fields of its manifest.
	 */
	packages?: Record<string, string>;

	/**
	 * Directories laid out as `node_modules`: a package is looked up at `<root>/<package name>`
	 */
	roots?: string[];
}

export /*bundle*/ interface ILimitsInput {
	/**
	 * The time the check may take, in milliseconds (default 60000)
	 */
	ms?: number;

	/**
	 * How many files, besides the TypeScript default libraries, the program may load (default 2000)
	 */
	files?: number;

	/**
	 * How many diagnostics are returned; the summary still counts all of them (default 500)
	 */
	diagnostics?: number;
}

/**
 * The part of an `AbortSignal` the check reads, so that a caller cancels it without depending on a platform
 */
export /*bundle*/ interface ICancelSignal {
	readonly aborted: boolean;
}

export /*bundle*/ interface IDiagnosticsRequest {
	module: IModuleInput;
	conditions: IDiagnosticsConditions;
	sources?: ISourcesInput;
	dependencies?: IDependenciesInput;
	limits?: ILimitsInput;
	signal?: ICancelSignal;
}

export /*bundle*/ interface IPosition {
	/**
	 * Zero-based line and character, as editors and language servers exchange them
	 */
	line: number;
	character: number;
}

export /*bundle*/ type DiagnosticCategory = 'semantic' | 'syntactic' | 'options' | 'types-unresolved';

export /*bundle*/ interface ISemanticDiagnostic {
	category: DiagnosticCategory;

	/**
	 * The TypeScript code, such as `TS2322`, or `TYPES_UNRESOLVED` for the `types-unresolved` category, whose
	 * TypeScript code is then reported as `origin`
	 */
	code: string;
	origin?: string;

	severity: 'error' | 'warning';
	message: string;

	/**
	 * The file relative to the package. A diagnostic of the configuration as a whole has no file.
	 */
	file?: string;
	range?: { start: IPosition; end: IPosition };

	/**
	 * The bare specifier whose types were not found, for the `types-unresolved` category
	 */
	specifier?: string;

	/**
	 * How many times the same unresolved types were reported; only the first location is kept
	 */
	occurrences?: number;
}

export /*bundle*/ type OutcomeCode =
	| 'DIAGNOSTICS_LIMIT_EXCEEDED'
	| 'DIAGNOSTICS_CANCELLED'
	| 'DIAGNOSTICS_INPUT_INVALID'
	| 'DIAGNOSTICS_FAILED';

/**
 * Why a check did not cover the whole module
 */
export /*bundle*/ interface IOutcome {
	code: OutcomeCode;
	message: string;

	/**
	 * The limit that was exceeded, for `DIAGNOSTICS_LIMIT_EXCEEDED`
	 */
	limit?: 'ms' | 'files';
}

export /*bundle*/ interface IMeasured {
	/**
	 * The duration of the whole check, in milliseconds
	 */
	ms: number;

	/**
	 * The files the program loaded, besides the TypeScript default libraries
	 */
	files: number;

	program: {
		typescript: string;

		/**
		 * The configuration that applied: a file relative to the package, `inline` or `defaults`
		 */
		configuration: string;
		strict: boolean;

		/**
		 * The sources of the module, the files of its dependencies and the default libraries in the program
		 */
		sources: number;
		dependencies: number;
		libraries: number;

		/**
		 * The duration of each phase: reading the input, creating the program and checking it
		 */
		phases: { setup: number; create: number; check: number };
	};
}

export /*bundle*/ interface IDiagnosticsResult {
	/**
	 * Whether every source of the module was checked. When it is false, `outcome` explains why, and the
	 * diagnostics are those obtained until then.
	 */
	complete: boolean;
	outcome?: IOutcome;

	diagnostics: ISemanticDiagnostic[];

	summary: {
		errors: number;
		warnings: number;

		/**
		 * The bare specifiers whose types were not found
		 */
		unresolved: string[];

		/**
		 * How many reports of an implicit `any` were left out because types are unresolved: what comes from a
		 * dependency without types is `any`, so they cannot be told apart from consequences of the missing types
		 */
		withheld: number;

		/**
		 * Whether `diagnostics` was cut at `limits.diagnostics`
		 */
		truncated: boolean;
	};

	measured: IMeasured;
}

/**
 * The members of a workspace package that `Diagnostics.module()` reads. A `Package` of
 * `@beyond-js/packages/package` satisfies it.
 */
export /*bundle*/ interface IPackageLike {
	path: string;
	name: string;
	version: string;
	ready: Promise<unknown>;
	modules: {
		ready: Promise<unknown>;
		get(subpath: string): { spec: { path?: string; entry?: string } } | undefined;
	};
}
