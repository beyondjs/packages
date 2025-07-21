import { NpmRegistry } from './npm';
import type { RepositoriesSettings } from '@beyond-js/packages/repositories/settings';

export /*bundle*/ class Registries {
	#npm: NpmRegistry;
	get npm() {
		return this.#npm;
	}

	constructor(settings: RepositoriesSettings) {
		this.#npm = new NpmRegistry(settings);
	}
}
