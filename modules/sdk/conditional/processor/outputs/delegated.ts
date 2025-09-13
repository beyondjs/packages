import { OutputsCollection } from './collection';

export class DelegatedOutputs extends Map<string, OutputsCollection> {
	constructor({ delegates }: { delegates: Set<string> }) {
		super();
		delegates.forEach(name => this.set(name, new OutputsCollection()));
	}
}
