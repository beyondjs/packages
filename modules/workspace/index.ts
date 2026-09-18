import type { IDiagnostic } from '@beyond-js/packages/types';
import { DynamicProcessor } from '@beyond-js/dynamic-processor/main';
import type { PropertyObjectType } from '@beyond-js/config/main';
import { Config } from '@beyond-js/config/main';
import { Package } from '@beyond-js/packages/package';
import { equal } from '@beyond-js/equal/main';
import { isAbsolute, resolve, relative, dirname, basename, sep, posix } from 'path';

interface IProcessDone {
	errors?: IDiagnostic[];
	warnings?: IDiagnostic[];
	packages?: Set<string>;
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
}

/**
 * The packages being developed together.
 *
 * A workspace reads which packages it contains from its `beyond.json` and creates one Package for each,
 * which is also what makes them resolvable between themselves: a public reference from one package to
 * another is satisfied by the package of the workspace, not by an installed copy of it.
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
	get packages() {
		return this.#packages;
	}

	#options: IWorkspaceOptions;
	get options() {
		return this.#options;
	}

	constructor(path = process.cwd(), options: IWorkspaceOptions = {}) {
		super();

		this.#path = path;
		this.#options = options;

		// Packages given by the caller replace the configuration file, which is then neither read nor required
		if (options.packages) return;

		const config = new Config(path);
		this.#config = config;

		config.data = 'beyond.json';
		super.setup(new Map([['config', { child: config }]]));
	}

	_process() {
		const done = ({ errors, warnings, packages }: IProcessDone) => {
			errors = errors || [];
			warnings = warnings || [];
			packages = packages || new Set();
			const previous = { errors: this.#errors, warnings: this.#warnings, packages: [...this.#packages.keys()] };

			const changed = !equal(previous, { errors, warnings, packages: [...packages] });
			if (!changed) return false;

			this.#errors = errors;
			this.#warnings = warnings;

			// Destroy unused packages
			this.#packages.forEach((pkg, path) => {
				if (packages.has(path)) return;
				pkg.destroy();
				this.#packages.delete(path);
			});

			// Add new packages
			packages.forEach(path => {
				if (this.#packages.has(path)) return;

				const fulldir = resolve(this.#path, path);
				const pkg = new Package(fulldir, { watcher: this.#options.watcher });
				this.#packages.set(path, pkg);
			});
		};

		if (this.#config && !this.#config.valid) return done({ errors: this.#config.errors });

		const value: PropertyObjectType = this.#config ? this.#config.value : { packages: this.#options.packages };
		if (value.packages && !Array.isArray(value.packages)) {
			const code = 'INVALID_PACKAGES_PROPERTY';
			const message = '"packages" must be an array of strings';
			return done({ errors: [{ code, message }] });
		}

		const packages: string[] = value?.packages || ['.'];
		const output: Set<string> = new Set();
		const warnings = [];

		packages.forEach((path: string) => {
			if (!path || typeof path !== 'string') {
				const code = 'INVALID_PACKAGE_PATH';
				const message = `Each package path must be a non-empty string. Found: ${path}`;
				warnings.push({ code, message });
				return;
			}
			if (path.startsWith('..')) {
				const code = 'INVALID_PACKAGE_PATH';
				const message = `Package paths cannot point to parent directories. Found: ${path}`;
				warnings.push({ code, message });
				return;
			}
			if (isAbsolute(path)) {
				const code = 'INVALID_PACKAGE_PATH';
				const message = `Package paths cannot be absolute. Found: ${path}`;
				warnings.push({ code, message });
				return;
			}

			// Normalize package paths using 'path' module, resolving them against the workspace path
			// Normilized path must be relative to the workspace path
			const abs = resolve(this.#path, path);

			let normalized = relative(this.#path, abs).split(sep).join(posix.sep);
			basename(normalized) === 'package.json' && (normalized = dirname(normalized));

			output.add(normalized);
		});

		return done({ packages: output });
	}

	/**
	 * The public module of the workspace that a public specifier addresses, such as `@suite/shared/message`.
	 *
	 * The packages of the workspace take precedence over any other source of a package with the same name,
	 * which is what lets a package under development satisfy the dependencies of its siblings. Resolution
	 * reads the name of each package, so the packages must have been processed for it to be conclusive.
	 *
	 * @returns undefined when no package of the workspace publishes the specifier
	 */
	resolve(specifier: string): IWorkspaceResolution | undefined {
		if (typeof specifier !== 'string' || !specifier) return;

		const split = specifier.split('/');
		const scope = split[0].startsWith('@') ? split.shift() : void 0;
		const name = split.shift();
		if (!name) return;

		const pkgname = scope ? `${scope}/${name}` : name;
		const subpath = split.length ? `./${split.join('/')}` : '.';

		for (const pkg of this.#packages.values()) {
			if (pkg.name !== pkgname) continue;
			return { specifier, package: pkg, subpath };
		}
	}

	destroy() {
		super.destroy();
		this.#packages.forEach(pkg => pkg.destroy());
		this.#packages.clear();
	}
}
