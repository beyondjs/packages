import type { IProject } from '@beyond-js/packages/project/types';
import type { IDiagnostic } from '@beyond-js/packages/types';
import type { Registry } from '../registry';
import type { IGraphLogger } from '../policy';
import { type DependencyKind, DependenciesSpec } from '@beyond-js/packages/dependencies/spec';
import { DependencySource, DependencySourceIsType } from '@beyond-js/packages/dependency-source';
import { NodeDependencies } from './dependencies';
import { Version } from './version';
import { Peer } from './peer';
import { type INodeRelease, Release } from './release';
import type { INodeConstructorParams } from './params';

/**
 * One occurrence of a dependency: a package required by one dependent with one version specifier. Two
 * dependents of the same package are two occurrences, each with its own identity, even when they share
 * a release.
 */
export /*bundle*/ class Node {
	#project: IProject;
	get project() {
		return this.#project;
	}

	#registry: Registry;
	get registry() {
		return this.#registry;
	}

	#logger: IGraphLogger;
	get logger() {
		return this.#logger;
	}

	#id: string;
	/**
	 * Identity of the occurrence: the declared names that lead to it from the root
	 */
	get id() {
		return this.#id;
	}

	/**
	 * Names of the packages from the root (excluded) to this occurrence (included)
	 */
	get path(): string[] {
		return this.#parent ? [...this.#parent.path, this.#package] : [];
	}

	#kind: DependencyKind;
	get kind() {
		return this.#kind;
	}

	#optional: boolean;
	/**
	 * True when the graph stays valid if this occurrence fails: an optional dependency or an optional peer
	 */
	get optional() {
		return this.#kind === 'optional' || this.#optional;
	}

	#package: string;
	/**
	 * The name the dependent declares. For an alias it differs from `source.package`, the resolved one
	 */
	get package() {
		return this.#package;
	}
	get scope() {
		return this.#source?.scope;
	}

	#source: DependencySource;
	/**
	 * The source the occurrence resolves: the target of an alias, the declared source otherwise
	 */
	get source() {
		return this.#source;
	}

	/**
	 * The version range the release is selected with. It differs from `version.specified` for an alias,
	 * whose specifier also names the target package
	 */
	get range(): string {
		return this.#source ? this.#source.spec : this.#version.specified;
	}

	#declared?: string;
	/**
	 * The version the dependent declares when an override replaced it; undefined otherwise
	 */
	get declared() {
		return this.#declared;
	}

	#version: Version;
	get version() {
		return this.#version;
	}

	#parent?: Node;
	get parent() {
		return this.#parent;
	}

	#dependencies: NodeDependencies;
	get dependencies() {
		return this.#dependencies;
	}

	/**
	 * True for a peer requirement below the root: it is not installed, it is provided by a dependent
	 */
	get soft() {
		return this.#kind === 'peer' && !!this.#parent?.parent;
	}

	#peer?: Peer;
	/**
	 * The occurrence that provides this peer requirement
	 */
	get provider() {
		return this.#peer?.provider;
	}

	/**
	 * The dependent in whose context the peer requirement was provided
	 */
	get context() {
		return this.#peer?.context;
	}

	#link?: Node;
	/**
	 * The occurrence that expands the release, when it is not this one
	 */
	get link() {
		return this.#link;
	}

	#release?: INodeRelease;
	get release(): INodeRelease | undefined {
		return this.#link ? this.#link.release : this.#release;
	}

	#processing = false;
	get processing() {
		return this.#processing;
	}

	#processed = false;
	get processed() {
		return this.#processed;
	}

	#invalid?: IDiagnostic;
	#error: IDiagnostic;
	get error() {
		return this.#error;
	}

	constructor(params: INodeConstructorParams) {
		const { project, registry, dependency, parent } = params;
		const { package: pkg, version, kind } = dependency;

		if (!project || !pkg || (version !== '' && !version)) {
			throw new Error('Project, pkg and version are required parameters');
		}

		this.#project = project;
		this.#registry = registry;
		this.#logger = params.logger;
		this.#package = pkg;
		this.#version = new Version(version);
		this.#kind = kind;
		this.#optional = dependency.optional === true;
		this.#declared = dependency.declared !== version ? dependency.declared : void 0;
		this.#parent = parent;
		this.#id = parent ? `${parent.id}>${pkg}` : '#';
		this.#dependencies = new NodeDependencies(this);

		try {
			const source = new DependencySource(pkg, version);
			this.#source = source.target;
			if (source.data.is === DependencySourceIsType.Error) this.#invalid = source.data.error;
		} catch (exc) {
			this.#invalid = { code: 'INVALID_SPECIFIER', message: `Dependency "${pkg}" is not correctly specified` };
		}
	}

	invalidate() {
		if (!this.#processed) return;
		this.#processed = false;
		this.#dependencies.reset();
	}

	/**
	 * Gives the occurrence its version: selected from a range, pinned by its source, or, for a peer
	 * requirement, the one of the occurrence that provides it
	 */
	async register(update: boolean) {
		if (this.#invalid) return;

		if (!this.soft) return await this.#registry.nodes.register(this, update);

		this.#peer = new Peer(this, this.#optional);
		this.#peer.bind();
		const { provider } = this.#peer;
		if (!provider) return;

		// Only a provider of the same package can be constrained by the required range
		const same = provider.source?.id === this.#source.id;
		if (same && this.#source.data.is === DependencySourceIsType.Semver) {
			await this.#registry.nodes.register(this, update);
		}
		!this.#version.error && this.#version.update({ version: provider.version.resolved });
	}

	/**
	 * Called when the pass ends, with whether the release of the provider satisfies this peer requirement
	 */
	conclude(met: boolean): void {
		if (!this.#error) this.#error = this.#peer?.conclude(met);
	}

	async #expand(update: boolean): Promise<IDiagnostic | undefined> {
		if (this.#invalid) return this.#invalid;
		if (this.soft) return this.#version.error || this.#peer?.evaluate();

		const version = this.#version;
		if (version.error) return version.error;
		if (!version.resolved) {
			const code = 'VERSION_UNRESOLVED';
			return { code, message: `No version was selected for "${this.#package}@${version.specified}"` };
		}

		const { packages } = this.#project;
		const source = this.#source;
		const owner = this.#registry.releases.claim(`${source.id}@${version.resolved}`, this);
		if (owner !== this) this.#link = owner;

		// The occurrence that claims the release describes it; the others read it through their link
		if (!this.#link) {
			const release = new Release();
			const error = await release.load(packages, source, version.resolved);
			if (error) return error;
			this.#release = release;
		}

		const manifest = this.release?.manifest;
		if (!manifest) return;
		await this.#dependencies.process(new DependenciesSpec(manifest), update);
	}

	/**
	 * Fetches the package dependencies and processes them.
	 * If the node is already processed or being processed, it throws an error.
	 *
	 * @param update - If true, pinned releases are ignored and the newest ones are selected.
	 */
	async process({ update }: { update: boolean }): Promise<void> {
		if (this.#processing || this.#processed) {
			throw new Error('Node is already processed or it is being processed');
		}
		this.#processing = true;
		this.#error = void 0;
		this.#link = void 0;

		try {
			this.#error = await this.#expand(update);
		} catch (exc) {
			// An unexpected failure is an error of this occurrence, never an unfinished graph
			this.#error = { code: 'NODE_PROCESS_FAILED', message: `"${this.#package}" could not be processed` };
		} finally {
			this.#processing = false;
			this.#processed = true;
		}

		const message = `Node ${this.#package}@${this.#version.specified} processed`;
		const error = this.#error;
		error ? this.#logger.error(`${message} with errors: ${error.code}`, error) : this.#logger.info(message);
	}

	async reprocess(update: boolean) {
		if (this.#processing) throw new Error('Node is already being processed');

		if (!this.#processed) {
			await this.process({ update });
			return;
		}

		this.#processing = true;
		try {
			await this.#dependencies.reprocess(update);
		} finally {
			this.#processing = false;
		}
	}
}
