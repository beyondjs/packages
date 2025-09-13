import type { Preprocessor } from '../preprocessor';
import { Delegator } from './delegator';

export class Delegators extends Map<string, Delegator> {
	constructor(preprocessor: Preprocessor, delegates: string[]) {
		super();

		/**
		 * Each name corresponds to a processor that is being delegated and added to this Map.
		 */
		delegates.forEach(name => {
			const delegate = new Delegator(name, preprocessor);
			this.set(name, delegate);
		});
	}

	destroy() {
		this.forEach(delegate => delegate.destroy());
	}
}
