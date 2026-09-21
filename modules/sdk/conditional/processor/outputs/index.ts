import { OutputsCollection } from './collection';
import { DelegatedOutputs } from './delegated';

/**
 * What a processor produces in one build, in the slots the conditional assembles:
 *
 * - `ims`, the internal modules, one per source file, which the ESM conditional composes into the artifact
 * - `styles`, the stylesheets, one per style source, which the conditional concatenates in a stable order
 *   into the stylesheet of the module
 * - `types`, the declarations, which the conditional concatenates into the public declaration of the module
 * - `delegated`, what this processor produces for the processors it delegates to
 *
 * A container is created fresh for every build and published only when that build is the current one.
 */
export /*bundle*/ class ProcessorOutputs {
	#ims = new OutputsCollection();
	get ims() {
		return this.#ims;
	}

	#types = new OutputsCollection();
	get types() {
		return this.#types;
	}

	#styles = new OutputsCollection();
	get styles() {
		return this.#styles;
	}

	#delegated: DelegatedOutputs;
	get delegated() {
		return this.#delegated;
	}

	constructor({ delegates }: { delegates: Set<string> }) {
		this.#delegated = new DelegatedOutputs({ delegates });
	}
}
