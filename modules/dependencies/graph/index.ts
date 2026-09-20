import type { IProject } from '@beyond-js/packages/project/types';
import type { IDiagnostic } from '@beyond-js/packages/types';
import { DependenciesSpec } from '@beyond-js/packages/dependencies/spec';
import { type IGraphOptions, type IGraphLogger, Policy } from './policy';
import { Registry } from './registry';
import { Selection } from './selection';
import { Closure } from './closure';
import { Node } from './node';

/**
 * The package/version graph of a project: which release satisfies each dependency, all the way down.
 *
 * The graph is resolved in passes. A pass walks the dependencies with the versions the previous pass
 * selected, then groups every requirement of each package and selects again. The resolution is settled
 * when a pass confirms the versions it was walked with; a limit of passes turns a graph that never
 * settles into an explicit failure. Dependencies are always walked in name order, and grouping is
 * canonical, so equal inputs give an equal graph whatever order they were declared in.
 */
export /*bundle*/ class DependenciesGraph extends Node {
	#project: IProject;
	#options: IGraphOptions;

	get logger(): IGraphLogger {
		return super.logger;
	}

	#processed = false;
	/**
	 * True once the resolution settled: every occurrence was processed with its final version. It does
	 * not mean the graph is valid: see `completed`.
	 */
	get processed() {
		return this.#processed;
	}

	#running = false;
	get processing() {
		return this.#running;
	}

	#closure?: Closure;
	/**
	 * The judgement of the settled graph: blocking and tolerated failures
	 */
	get closure() {
		return this.#closure;
	}

	#diagnostics: IDiagnostic[] = [];
	/**
	 * Failures of the resolution as a whole (not of one occurrence), such as an unsettled graph
	 */
	get diagnostics() {
		return this.#diagnostics;
	}

	#warnings: string[] = [];
	get warnings() {
		return this.#warnings;
	}

	#policy?: Policy;
	/**
	 * The rules of the last resolution: overrides, lock and limits in effect
	 */
	get policy() {
		return this.#policy;
	}

	#passes = 0;
	/**
	 * Passes the last resolution needed
	 */
	get passes() {
		return this.#passes;
	}

	/**
	 * True only for a valid closure: the resolution settled, and no required occurrence failed. A failed
	 * occurrence is processed, so being processed is never enough to be completed.
	 */
	get completed(): boolean {
		return this.#processed && !this.#diagnostics.length && !!this.#closure?.valid;
	}

	get valid(): boolean {
		return this.completed;
	}

	constructor(project: IProject, options: IGraphOptions = {}) {
		if (!project.processed) {
			throw new Error('The project must be processed before creating the dependencies graph');
		}

		const { name, version } = project;
		const silent = (): void => {};
		const logger = options.logger || { info: silent, warn: silent, error: silent };
		const registry = new Registry(project);
		super({ project, registry, logger, dependency: { kind: 'main', package: name, version } });

		this.#project = project;
		this.#options = options;
	}

	/**
	 * Resolves the graph
	 *
	 * @param update When true the lock is ignored, so the newest satisfying releases are selected
	 */
	async process({ update }: { update: boolean }) {
		if (this.#running) throw new Error('The dependencies graph is already being processed');
		this.#running = true;
		this.#processed = false;
		this.#closure = void 0;
		this.#diagnostics = [];
		this.#passes = 0;

		try {
			this.logger.info('Initializing dependencies graph');

			// The root node version is the version of the package for which dependencies are being processed
			// This version value can be treated as arbitrary, as it will not have impact
			// in the process of the dependencies graph
			this.version.update({ version: this.version.specified });

			const spec = new DependenciesSpec(this.#project.dependencies.spec);
			const options = update ? { ...this.#options, lock: void 0 } : this.#options;
			const policy = new Policy(options, spec, spec.overrides);
			this.registry.configure(policy);
			this.#policy = policy;
			this.#warnings = [...spec.warnings, ...policy.overrides.warnings];

			let selection = new Selection();
			let settled = false;
			while (!settled && this.#passes < policy.passes) {
				this.#passes++;

				// Each pass starts from a clean registry: no occurrence or expansion of a previous pass
				// survives, which is what bounds the cost of a version that changes
				this.dependencies.reset();
				this.registry.reset(selection);
				await this.dependencies.process(spec, update);

				const result = this.registry.regroup();
				settled = result.settled && this.dependencies.settled;
				selection = result.selection;
			}

			if (!settled) {
				const code = 'GRAPH_UNSETTLED';
				const message =
					`The dependencies graph did not settle after ${policy.passes} passes: ` +
					`the selected versions keep changing what is required`;
				this.#diagnostics.push({ code, message });
			}

			this.#processed = settled;
			this.#closure = new Closure(this);
		} finally {
			this.#running = false;
		}
	}
}
