import type { IDiagnostic } from '@beyond-js/packages/types';
import type { Execution } from '@beyond-js/packages/execution';
import { DynamicProcessor } from '@beyond-js/dynamic-processor/main';
import type { PropertyObjectType } from '@beyond-js/config/main';
import { Config } from '@beyond-js/config/main';
import { Package } from '@beyond-js/packages/package';
import { equal } from '@beyond-js/equal/main';
import { Locations, type ILocation, type IWorkspaceMember } from './locations';
import { Imports } from './imports';

interface IProcessDone {
	errors?: IDiagnostic[];
	warnings?: IDiagnostic[];
	packages?: Map<string, ILocation>;
}

export /*bundle*/ interface IWorkspaceOptions {
	/**
	 * Whether the packages watch their sources, so that editing a file rebuilds what depends on it.
	 * It requires a watchers service registered in the process; without one, the packages are read once.
	 */
	watcher?: boolean;

	/**
	 * The packages of the workspace, relative to its path, given by the caller instead of read from a
	 * `beyond.json`. It is how a standalone package is developed: `{ packages: ['.'] }` makes its directory
	 * a workspace of one package without writing a configuration file into the project.
	 */
	packages?: string[];

	/**
	 * The members of the workspace, as its declaration lists them, given by the caller instead of read from a
	 * `beyond.json`: each one is held under its id and read from its absolute directory, which may be outside
	 * the workspace. Two versions of one name are two members. They replace `packages` when both are given.
	 */
	members?: IWorkspaceMember[];

	/**
	 * Packages the toolchain supplies to every workspace, as absolute directories: the development
	 * runtime and the Widgets packages installed with Packages. They are compiled and served like the
	 * packages of the workspace, so a browser loads them from this environment, but they are not watched:
	 * an installation changes only when it is replaced.
	 */
	supplied?: string[];

	/**
	 * The execution projection of the installed graph of the workspace (`.beyond/execution.json`). With it,
	 * the edges of the importing package decide which package satisfies each bare specifier it imports, and
	 * nothing is resolved by name.
	 */
	execution?: Execution;
}

/**
 * Which public module of which package of the workspace a public specifier addresses
 */
export /*bundle*/ interface IWorkspaceResolution {
	specifier: string;
	package: Package;

	/**
	 * The subpath of the module inside the package, such as `./message` or `.`
	 */
	subpath: string;

	/**
	 * With an execution: the key of the member node that the importer's edge reaches, `workspace:<id>`
	 */
	node?: string;
}

/**
 * The packages being developed together.
 *
 * A workspace creates one Package for each package it declares: the members its caller gives, or the
 * packages of its `beyond.json`, and the packages the toolchain supplies. That is also what makes them
 * resolvable between themselves: a public reference from one package to another is satisfied by the
 * package of the workspace, not by an installed copy of it. With the execution projection of its installed
 * graph, several versions of one name can be members, and each importer reaches the one its edges select.
 */
export /*bundle*/ class Workspace extends DynamicProcessor() {
	get dp() {
		return 'workspace';
	}

	#path: string;
	get path() {
		return this.#path;
	}

	#config: Config;

	#errors: IDiagnostic[] = [];
	get errors(): IDiagnostic[] {
		return this.#errors;
	}

	#warnings: IDiagnostic[] = [];
	get warnings(): IDiagnostic[] {
		return this.#warnings;
	}

	get valid() {
		return !this.errors.length;
	}

	#packages: Map<string, Package> = new Map();

	/**
	 * The packages of the workspace by key: the member id, the path relative to the workspace, or the
	 * absolute directory of a package the toolchain supplies
	 */
	get packages() {
		return this.#packages;
	}

	#locations: Map<string, ILocation> = new Map();

	#options: IWorkspaceOptions;
	get options() {
		return this.#options;
	}

	/**
	 * The execution projection of the installed graph, when the caller gave one
	 */
	get execution(): Execution | undefined {
		return this.#options.execution;
	}

	#imports: Imports;

	/**
	 * How the bare specifiers the packages of the workspace import are satisfied
	 */
	get imports(): Imports {
		return this.#imports;
	}

	constructor(path = process.cwd(), options: IWorkspaceOptions = {}) {
		super();

		this.#path = path;
		this.#options = options;
		this.#imports = new Imports(this);

		// Packages given by the caller replace the configuration file, which is then neither read nor required
		if (options.members || options.packages) return;

		const config = new Config(path);
		this.#config = config;

		config.data = 'beyond.json';
		super.setup(new Map([['config', { child: config }]]));
	}

	_process() {
		const done = ({ errors, warnings, packages }: IProcessDone) => {
			errors = errors || [];
			warnings = warnings || [];
			packages = packages || new Map();
			const previous = { errors: this.#errors, warnings: this.#warnings, packages: [...this.#locations] };

			const changed = !equal(previous, { errors, warnings, packages: [...packages] });
			if (!changed) return false;

			this.#errors = errors;
			this.#warnings = warnings;
			this.#locations = packages;

			// Destroy the packages that are no longer declared, or no longer at the same directory
			this.#packages.forEach((pkg, key) => {
				if (packages.get(key)?.path === pkg.path) return;
				pkg.destroy();
				this.#packages.delete(key);
			});

			// Add the new packages; a supplied package is never watched
			packages.forEach(({ path, supplied }, key) => {
				if (this.#packages.has(key)) return;
				const pkg = new Package(path, { watcher: !supplied && this.#options.watcher, workspace: this });
				this.#packages.set(key, pkg);
			});
		};

		if (this.#config && !this.#config.valid) return done({ errors: this.#config.errors });

		const { members, supplied } = this.#options;
		const value: PropertyObjectType = this.#config ? this.#config.value : { packages: this.#options.packages };
		const locations = new Locations(this.#path, { members, packages: value?.packages, supplied });
		if (locations.errors.length) return done({ errors: locations.errors });

		return done({ packages: locations.entries, warnings: locations.warnings });
	}

	/**
	 * Whether a package of the workspace is one the toolchain supplies
	 */
	supplies(pkg: Package): boolean {
		const key = [...this.#packages].find(([, one]) => one === pkg)?.[0];
		return !!this.#locations.get(key)?.supplied;
	}

	/**
	 * The package of the workspace that a public specifier addresses, such as `@suite/shared/message`.
	 *
	 * The packages of the workspace take precedence over any other source of a package with the same name,
	 * which is what lets a package under development satisfy the dependencies of its siblings. With an
	 * execution, the edges of the importer decide which instance of a name it reaches; without one, a name
	 * held by several packages answers nothing rather than the first of them (`imports.resolve()` says why).
	 * Resolution reads the name of each package, so the packages must have been processed for it to be
	 * conclusive.
	 *
	 * @param importer The package that imports the specifier
	 * @returns undefined when no package of the workspace satisfies the specifier
	 */
	resolve(specifier: string, importer?: Package): IWorkspaceResolution | undefined {
		const found = this.#imports.resolve(specifier, importer);
		if (!found?.package || found.error) return;
		const node = found.key ? { node: found.key } : {};
		return { specifier, package: found.package, subpath: found.subpath, ...node };
	}

	destroy() {
		super.destroy();
		this.#packages.forEach(pkg => pkg.destroy());
		this.#packages.clear();
	}
}
