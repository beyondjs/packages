/**
 * The workspace modules behind an entry point, and whether all of them build.
 *
 * Executing a module needs more than its own artifact: every workspace module it reaches has to be
 * deliverable, or the consumer fails halfway through its imports. The graph is followed through the
 * dependencies Packages resolved for each compiled module; nothing is inferred from sources here.
 */
export class Graph {
	#delivery;
	#conditions;

	/**
	 * @param {object} delivery The Delivery of the workspace
	 * @param {{platform: string, environment?: string}} conditions
	 */
	constructor(delivery, conditions) {
		this.#delivery = delivery;
		this.#conditions = conditions;
	}

	/**
	 * @param {{name: string, version: string, subpath: string, vspecifier: string}} entry
	 * @returns {Promise<{modules: string[], failures: {vspecifier: string, code: string, message: string,
	 * diagnostics?: {code: string, message: string}[]}[]}>}
	 */
	async check(entry) {
		const published = new Map((await this.#delivery.published()).map(module => [module.vspecifier, module]));
		const visited = new Set();
		const failures = [];
		const pending = [entry.vspecifier];

		while (pending.length) {
			const vspecifier = pending.pop();
			if (visited.has(vspecifier)) continue;
			visited.add(vspecifier);

			const module = published.get(vspecifier);
			if (!module) {
				failures.push({ vspecifier, code: 'MODULE_NOT_FOUND', message: `"${vspecifier}" is not a module of the workspace` });
				continue;
			}

			const { delivered, failure } = await this.#delivery.module(module, this.#conditions);
			if (failure) {
				failures.push({ vspecifier, ...failure });
				continue;
			}
			delivered.dependencies
				.filter(dependency => dependency.source === 'workspace')
				.forEach(dependency => pending.push(dependency.vspecifier));
		}

		return { modules: [...visited], failures };
	}
}
