import type { Package } from '../';

/**
 * Package controller is responsible for listening to files changes
 * and triggering the build of the corresponding conditionals.
 */
export class PackageController {
	#package: Package;

	constructor(pkg: Package) {
		this.#package = pkg;
		const { watcher } = pkg;
	}
}
