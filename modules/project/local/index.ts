import type { RequireType } from '@beyond-js/dynamic-processor/main';
import type { IProject } from '@beyond-js/packages/project/types';
import type { Workspace } from '@beyond-js/packages/workspace';
import type { Package } from '@beyond-js/packages/package';
import { DynamicProcessor } from '@beyond-js/dynamic-processor/main';
import { ProjectDependencies } from './dependencies';
import { PackageProviders } from './packages';
import { IDiagnostic } from '@beyond-js/packages/types';

export /*bundle*/ class Project extends DynamicProcessor() implements IProject {
	get dp() {
		return 'project';
	}

	#workspace: Workspace;
	get workspace() {
		return this.#workspace;
	}

	#package: Package;
	get package() {
		return this.#package;
	}

	#name: string;
	get name() {
		return this.#name;
	}

	#version: string;
	get version() {
		return this.#version;
	}

	get vname() {
		return `${this.#name}@${this.#version}`;
	}

	#dependencies: ProjectDependencies;
	get dependencies() {
		return this.#dependencies;
	}

	#packages: PackageProviders;
	get packages() {
		return this.#packages;
	}

	#error: IDiagnostic;
	get error() {
		return this.#error;
	}
	get valid() {
		return !this.#error;
	}

	constructor(workspace: Workspace, name: string, version: string) {
		super();
		this.#workspace = workspace;
		this.#name = name;
		this.#version = version;

		super.setup(new Map([['workspace', { child: workspace }]]));
	}

	_prepared(require: RequireType) {
		this.#workspace.packages.forEach(pkg => require(pkg, pkg.path));
	}

	_process() {
		const pkg = [...this.#workspace.packages.values()].find(
			({ name, version }) => name === this.#name && version === this.#version
		);

		const done = ({ error, pkg }: { error?: IDiagnostic; pkg?: Package }) => {
			if (error && this.#error) return false;

			this.#error = error;
			this.#package = pkg;

			if (error) {
				this.#dependencies = void 0;
				this.#packages = void 0;
			} else {
				this.#dependencies = new ProjectDependencies(this);
				this.#packages = new PackageProviders(this);
			}
		};

		if (!pkg) {
			const code = 'PROJECT_PACKAGE_NOT_FOUND';
			const message = `The package "${this.#name}@${this.#version}" does not exist in the workspace`;
			return done({ error: { code, message } });
		}

		return done({ pkg });
	}
}
