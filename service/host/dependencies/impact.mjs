/**
 * What a plan affects beyond the graph: the members whose dependencies change (the nodes their closure reaches are
 * not the same in both graphs, or their manifest is edited), the public modules those members publish (from the
 * served workspace's `published()`), and the execution targets whose package is one of them (from the catalog of
 * applications the development extension shares, when it is there). It reads; nothing is built or started.
 */
export class Impact {
	/**
	 * Modules listed at most; the count is always complete
	 */
	static LIMIT = 200;

	/**
	 * Milliseconds the served workspace and the catalog of applications are given to answer: past it the plan says
	 * they were not available instead of waiting
	 */
	static BOUND = 10000;

	#members;
	#modules;
	#targets;

	/**
	 * @param {{current: import('./graph.mjs').Graph, proposed: import('./graph.mjs').Graph, edits: object[], importers:
	 * {id: string, name: string, version: string}[], workspace?: {published(): Promise<object[]>}, applications?:
	 * {catalog?(): unknown}}} inputs
	 */
	static async compose({ current, proposed, edits, importers, workspace, applications }) {
		const impact = new Impact();
		impact.#members = Impact.#affected({ current, proposed, edits, importers });
		impact.#modules = await Impact.#published(workspace, impact.#members);
		impact.#targets = await Impact.#catalog(applications, impact.#members);
		return impact;
	}

	/**
	 * The members whose closure differs between the graphs, with the external nodes only one of them reaches
	 */
	static #affected({ current, proposed, edits, importers }) {
		const edited = new Set(edits.map(({ member }) => member));
		const affected = [];
		for (const { id, name, version } of importers) {
			const reaches = graph => {
				const start = graph.members[id]?.node ?? `workspace:${id}`;
				return graph.has(start) ? graph.closure(start, 'out') : new Set();
			};
			const [before, after] = [reaches(current), reaches(proposed)];
			const external = key => !key.startsWith('workspace:');
			const changed = [...before].filter(key => !after.has(key)).concat([...after].filter(key => !before.has(key))).filter(external).sort();
			if (!changed.length && !edited.has(id)) continue;
			affected.push({ id, name, version, ...(edited.has(id) ? { edited: true } : {}), nodes: changed });
		}
		return affected;
	}

	/**
	 * What a read answers within the bound, or a rejection that says it did not
	 */
	static #bounded(read, what) {
		let timer;
		const late = new Promise((resolve, reject) => {
			timer = setTimeout(() => reject(new Error(`${what} did not answer within ${Impact.BOUND} ms`)), Impact.BOUND);
		});
		return Promise.race([Promise.resolve().then(read), late]).finally(() => clearTimeout(timer));
	}

	static async #published(workspace, members) {
		if (typeof workspace?.published !== 'function') return { available: false, count: 0, list: [] };
		let published;
		try {
			published = await Impact.#bounded(() => workspace.published(), 'The served workspace');
		} catch (error) {
			return { available: false, count: 0, list: [], reason: error?.message ?? String(error) };
		}
		const named = new Set(members.map(({ name, version }) => `${name}@${version}`));
		const list = (published ?? []).filter(({ name, version }) => named.has(`${name}@${version}`)).map(({ specifier, vspecifier, name }) => ({ specifier, vspecifier, package: name }));
		return { available: true, count: list.length, list: list.slice(0, Impact.LIMIT) };
	}

	static async #catalog(applications, members) {
		if (typeof applications?.catalog !== 'function') return { available: false, list: [] };
		let catalog;
		try {
			catalog = await Impact.#bounded(() => applications.catalog(), 'The catalog of applications');
		} catch (error) {
			return { available: false, list: [], reason: error?.message ?? String(error) };
		}
		const names = new Set(members.map(({ name }) => name));
		const list = [];
		for (const application of Array.isArray(catalog?.applications) ? catalog.applications : []) {
			for (const target of Array.isArray(application?.targets) ? application.targets : []) {
				names.has(target?.package) && list.push({ application: application.id, target: target.id, package: target.package });
			}
		}
		return { available: true, list };
	}

	toJSON() {
		return { members: this.#members, modules: this.#modules, targets: this.#targets };
	}
}
