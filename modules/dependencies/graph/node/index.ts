import type { DependencyKind } from '@beyond-js/packages/dependencies/spec';
import type { IProject } from '@beyond-js/packages/project/types';
import type { Registry } from '../registry';
import type { Logger } from '@beyond-js/packages/logs';
import type { IDiagnostic } from '@beyond-js/packages/types';
import { DependencyParser } from '@beyond-js/packages/providers/dependency/parser';
import { NodeDependencies } from './dependencies';
import { Version } from './version';
import { DependenciesSpec } from '@beyond-js/packages/dependencies/spec';

export interface INodeConstructorParams {
	project: IProject;
	registry: Registry;
	logger: Logger;
	dependency: { kind: DependencyKind; package: string; version: string };
	parent?: Node;
}

export class Node {
	#project: IProject;
	get project() {
		return this.#project;
	}

	#registry: Registry;
	get registry() {
		return this.#registry;
	}

	#logger: Logger;
	get logger() {
		return this.#logger;
	}

	#kind: DependencyKind;
	get kind() {
		return this.#kind;
	}

	#package: string;
	get package() {
		return this.#package;
	}

	#version: Version;
	get version() {
		return this.#version;
	}

	#parsed: DependencyParser;
	get data() {
		return this.#parsed.data;
	}

	#parent?: Node;
	get parent() {
		return this.#parent;
	}

	#dependencies;
	get dependencies() {
		return this.#dependencies;
	}

	#processing = false;
	get processing() {
		return this.#processing;
	}

	#processed = false;
	get processed() {
		return this.#processed;
	}

	#error: IDiagnostic;
	get error() {
		return this.#error;
	}

	constructor(params: INodeConstructorParams) {
		const { project, registry, dependency, parent } = params;
		const { package: pkg, version } = dependency;

		if (!project || !pkg || !version) {
			throw new Error('Project, pkg and version are required parameters');
		}

		this.#project = project;
		this.#registry = registry;
		this.#logger = params.logger;
		this.#package = pkg;
		this.#version = new Version(version);
		this.#parent = parent;
		this.#parsed = new DependencyParser(pkg, version);
		this.#dependencies = new NodeDependencies(this);

		this.#version.on('change', this.invalidate.bind(this));
	}

	invalidate() {
		if (!this.#processed) return;

		this.#processed = false;
		this.#dependencies.invalidate();
	}

	async register() {
		await this.#registry.nodes.register(this);
	}

	/**
	 * Fetches the package dependencies and processes them.
	 * If the node is already processed or being processed, it throws an error.
	 * @returns
	 */
	async process(): Promise<void> {
		if (this.#processing || this.#processed) {
			throw new Error('Node is already processed or it is being processed');
		}
		this.#processing = true;
		this.#error = void 0;

		const done = ({ error }: { error?: IDiagnostic }) => {
			this.#error = error;
			this.#processing = false;
			this.#processed = true;

			const message = `Node ${this.#package}@${this.#version.specified} processed`;
			error ? this.#logger.error(`${message} with errors: ${error.code}`, error) : this.#logger.info(message);
		};

		// When the node is registered (registry.nodes.register(...)), the version is resolved,
		// so it is already processed at this point.
		const version = this.#version;
		if (version.error) return done({ error: version.error });

		const { specified, resolved } = version;
		const { error, manifest } = await this.#project.packages.manifest(this.#package, specified, resolved);
		if (error) return done({ error });

		console.log('manifest', manifest);
		if (!manifest) {
			const code = 'PACKAGE_MANIFEST_UNAVAILABLE';
			const message = `The manifest for package "${this.#package}@${this.#version.resolved}" is not available`;
			return done({ error: { code, message } });
		}

		const dependencies = new DependenciesSpec(manifest);
		await this.#dependencies.process(dependencies);
		return done({});
	}

	async reprocess() {
		if (this.#processing) {
			throw new Error('Node is already being processed');
		}

		if (!this.#processed) {
			await this.process();
			return;
		}

		this.#processing = true;
		await this.#dependencies.reprocess();
		this.#processing = false;
	}
}
