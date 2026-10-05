import type { IWorkspaceMembers } from '@beyond-js/packages/project/types';
import { type IDependencySpec, DependenciesSpec } from '@beyond-js/packages/dependencies/spec';

/**
 * What the root of a workspace graph declares: its importers, the packages whose own dependencies the workspace
 * installs. Each one is required through the member it is (`workspace:<id>`) and keyed by its node key, because
 * several members may provide one name.
 */
export class Importers extends Map<string, IDependencySpec> {
	#warnings: string[] = [];
	/**
	 * What the members declare that cannot be read, by member: their dependents would otherwise miss it silently.
	 * The root package (`.`) is what the root of the graph declares, which reports its own
	 */
	get warnings() {
		return this.#warnings;
	}

	constructor(members: IWorkspaceMembers) {
		super();

		for (const { id, name, manifest } of members.importers) {
			// An id that would read as a range names its member with a leading `./`, which is not part of the id
			const member = id.startsWith('.') ? id : `./${id}`;
			this.set(`workspace:${id}`, { version: `workspace:${member}`, kind: 'main', package: name });

			if (id === '.') continue;
			new DependenciesSpec(manifest).warnings.forEach(warning =>
				this.#warnings.push(`The member "${id}": ${warning}`)
			);
		}
	}
}
