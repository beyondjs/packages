import type { IDiagnostic } from '@beyond-js/packages/types';
import { DynamicProcessor } from '@beyond-js/dynamic-processor/main';
import type { PropertyObjectType } from '@beyond-js/config/main';
import { Config } from '@beyond-js/config/main';
import { Package } from '@beyond-js/packages/package';
import { equal } from '@beyond-js/equal/main';
import { isAbsolute, resolve, relative, sep, posix } from 'path';

interface IProcessDone {
	errors?: IDiagnostic[];
	warnings?: IDiagnostic[];
	packages?: Set<string>;
}

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

	constructor(path = process.cwd()) {
		super();

		this.#path = path;
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
			if (!changed) return;

			this.#errors = errors;
			this.#warnings = warnings;
			this.#packages.clear();

			// Destroy unused packages
			this.#packages.forEach((pkg, path) => packages.has(path) && pkg.destroy());

			// Add new packages
			packages.forEach(path => {
				if (this.#packages.has(path)) return;

				const pkg = new Package(path);
				this.#packages.set(path, pkg);
			});
		};

		const { valid, errors } = this.#config;
		if (!valid) return done({ errors });

		const value: PropertyObjectType = this.#config.value;
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
			const normalized = relative(this.#path, abs).split(sep).join(posix.sep);

			output.add(normalized);
		});

		return done({ packages: output });
	}
}
