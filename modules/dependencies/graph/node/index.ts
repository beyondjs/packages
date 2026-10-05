import type { IProject } from '@beyond-js/packages/project/types';
import type { IDiagnostic } from '@beyond-js/packages/types';
import type { Registry } from '../registry';
import type { IGraphLogger } from '../policy';
import { type DependencyKind, DependenciesSpec } from '@beyond-js/packages/dependencies/spec';
import type { DependencySource } from '@beyond-js/packages/dependency-source';
import { NodeDependencies } from './dependencies';
import { Version } from './version';
import { Peer } from './peer';
import { NodeSource } from './source';
import { Claim } from './claim';
import type { INodeRelease } from './release';
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
	 * Identity of the occurrence: the declared names that lead to it from the root. An importer of a workspace is
	 * identified by its node key instead (`workspace:<id>`), because several members may provide one name
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
	 * The source the occurrence resolves: the target of an alias, the workspace for a name a member provides, the
	 * declared source otherwise (see `NodeSource`)
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
	 * True for an importer of a workspace (a member, or the root package): the top of its own dependencies. Its
	 * development dependencies are followed on request and its peers are resolved as its own dependencies
	 */
	get importer(): boolean {
		return !!this.#parent && !this.#parent.parent && !!this.#project.members;
	}

	/**
	 * True for a peer requirement below the top: it is not installed, it is provided by a dependent
	 */
	get soft() {
		return this.#kind === 'peer' && !!this.#parent?.parent && !this.#parent.importer;
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

	#claim: Claim;
	/**
	 * The occurrence that expands the release, when it is not this one
	 */
	get link() {
		return this.#claim.link;
	}

	get release(): INodeRelease | undefined {
		return this.#claim.release;
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
		this.#id = parent ? `${parent.id}>${dependency.key || pkg}` : '#';
		this.#dependencies = new NodeDependencies(this);
		this.#claim = new Claim(this);

		// What is local to the workspace may declare a `workspace:` specifier: the root of the graph, an importer
		// (whose release is its member) and an override of the root
		const local = !parent?.parent || !!parent.release?.member || this.#declared !== void 0;
		const source = new NodeSource(project, pkg, version, local);
		this.#source = source.value;
		this.#invalid = source.error;
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

		if (!this.soft) {
			await this.#registry.nodes.register(this, update);

			// An importer claims its member before anything is expanded: every other occurrence of it links here
			const { error, resolved } = this.#version;
			if (this.importer && !error && resolved) await this.#claim.take();
			return;
		}

		this.#peer = new Peer(this, this.#optional);
		await this.#peer.register(update);
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

		// The occurrence that claims the release describes it; the others read it through their link
		const error = await this.#claim.take();
		if (error) return error;

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
		this.#claim.reset();

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
