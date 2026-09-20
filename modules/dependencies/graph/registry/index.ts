import type { IProject } from '@beyond-js/packages/project/types';
import type { Policy } from '../policy';
import { DependencyPackage } from './package';
import { Nodes } from './nodes';
import { Releases } from './releases';
import { Selection } from '../selection';

/**
 * What a resolution pass knows: every dependency occurrence, the packages they require, the releases
 * already expanded and the versions the previous pass selected.
 */
export /*bundle*/ class Registry {
	#packages: Map<string, DependencyPackage>;
	get packages() {
		return this.#packages;
	}

	#nodes: Nodes;
	get nodes() {
		return this.#nodes;
	}

	#releases = new Releases();
	get releases() {
		return this.#releases;
	}

	#policy: Policy;
	get policy() {
		return this.#policy;
	}

	#selection = new Selection();
	/**
	 * The versions selected by the previous pass, which this pass is walked with
	 */
	get selection() {
		return this.#selection;
	}

	constructor(project: IProject, policy?: Policy) {
		this.#packages = new Map();
		this.#policy = policy;
		this.#nodes = new Nodes(project, this);
	}

	/**
	 * Sets the rules of the resolution that is about to start
	 */
	configure(policy: Policy) {
		this.#policy = policy;
	}

	/**
	 * Starts a pass: forgets occurrences and expansions, and keeps the selection to walk with
	 */
	reset(selection: Selection) {
		this.#selection = selection;
		this.#packages.clear();
		this.#nodes.clear();
		this.#releases.clear();
	}

	/**
	 * Ends a pass: groups the requirements of every package and selects their versions.
	 *
	 * @returns The selection of this pass, and whether it confirms the versions the pass was walked with
	 */
	regroup(): { selection: Selection; settled: boolean } {
		const selection = new Selection();
		let settled = true;

		for (const id of [...this.#packages.keys()].sort()) {
			const dependency = this.#packages.get(id);
			settled = dependency.nodes.semver.regroup(selection) && settled;
		}
		return { selection, settled };
	}
}
