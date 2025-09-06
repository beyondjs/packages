import type { Preprocessor } from '../preprocessor';
import { ExtenderExtension } from './extension';

export class ExtenderExtensions extends Map {
	constructor(preprocessor: Preprocessor, extending: string[]) {
		super();

		/**
		 * Each name corresponds to a processor that is being extended and added to this Map.
		 */
		extending.forEach(name => {
			const extension = new ExtenderExtension(name, preprocessor);
			this.set(name, extension);
		});
	}
}
