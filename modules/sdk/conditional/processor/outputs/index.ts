import { OutputsCollection } from './collection';
import { DelegatedOutputs } from './delegated';
import { Output } from './output';

export class ProcessorOutputs {
	#ims = new OutputsCollection();
	get ims() {
		return this.#ims;
	}

	#types = new OutputsCollection();
	get types() {
		return this.#types;
	}

	#css = new Output();
	get css() {
		return this.#css;
	}

	#delegated: DelegatedOutputs;
	get delegated() {
		return this.#delegated;
	}

	constructor({ delegates }: { delegates: Set<string> }) {
		this.#delegated = new DelegatedOutputs({ delegates });
	}
}
