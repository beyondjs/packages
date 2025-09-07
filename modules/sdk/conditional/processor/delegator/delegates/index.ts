import type { Preprocessor } from '../preprocessor';
import { Delegate } from './delegate';

export class Delegates extends Map<string, Delegate> {
	constructor(preprocessor: Preprocessor, delegates: string[]) {
		super();

		/**
		 * Each name corresponds to a processor that is being delegated and added to this Map.
		 */
		delegates.forEach(name => {
			const delegate = new Delegate(name, preprocessor);
			this.set(name, delegate);
		});
	}

	destroy() {
		this.forEach(delegate => delegate.destroy());
	}
}
