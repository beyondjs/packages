import type { Preprocessor } from '../preprocessor';
import { Extension } from './extension';

export class Extensions extends Map<string, Extension> {
	constructor(preprocessor: Preprocessor, extending: string[]) {
		super();

		/**
		 * Each name corresponds to a processor that is being extended and added to this Map.
		 */
		extending.forEach(name => {
			const extension = new Extension(name, preprocessor);
			this.set(name, extension);
		});
	}

	destroy() {
		this.forEach(extension => extension.destroy());
	}
}
