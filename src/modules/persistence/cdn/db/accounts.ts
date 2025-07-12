import { Collection, SubCollection } from '@beyond-js/firestore-collection/collection';
import type { IAccountData, IProjectData } from '@beyond-js/packages/persistence/interfaces';

class Accounts extends Collection<IAccountData> {
	#projects: SubCollection<IProjectData>;
	get projects() {
		return this.#projects;
	}

	constructor() {
		super('Accounts');
		this.#projects = new SubCollection<IProjectData>('Projects', this);
	}
}

export /*bundle*/ const accounts = new Accounts();
