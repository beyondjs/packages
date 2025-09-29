import type { ErrorManager } from '@beyond-js/response/main';
import type { Providers } from '@beyond-js/packages/providers';
import type { Registry } from '../registry';
import type { DependencyKind } from '@beyond-js/packages/dependencies/spec';
import { DependencyInfo } from '@beyond-js/packages/providers/dependency/info';
import { NodeDependencies } from './dependencies';
import { Version } from './version';
import { DependenciesSpec } from '@beyond-js/packages/dependencies/spec';

export interface INodeConstructorParams {
	providers: Providers;
	registry: Registry;
	dependency: { kind: DependencyKind; package: string; version: string };
	parent?: Node;
}

export class Node {
	#providers: Providers;
	#registry: Registry;

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

	#info: DependencyInfo;
	get info() {
		return this.#info;
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

	#error: ErrorManager;
	get error() {
		return this.#error;
	}

	constructor(params: INodeConstructorParams) {
		const { providers, registry, dependency, parent } = params;
		const { kind, package: pkg, version } = dependency;

		if (!providers || !registry || !pkg || !version) {
			throw new Error('Providers, registry, pkg and version are required parameters');
		}

		this.#providers = providers;
		this.#registry = registry;
		this.#package = pkg;
		this.#version = new Version(version);
		this.#parent = parent;
		this.#dependencies = new NodeDependencies(this, providers, registry);

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

		const done = ({ error }: { error?: ErrorManager }) => {
			this.#error = error;
			this.#processing = false;
			this.#processed = true;
			console.log('done', this.package, this.version.specified, { error });
		};

		const version = this.#version;
		if (version.error) return done({ error: version.error });

		const { specified, resolved } = version;
		const { error, manifest } = await this.#providers.manifest(this.#package, specified, resolved);
		if (error) return done({ error });

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
