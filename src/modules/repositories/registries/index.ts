import { NpmRegistry } from './npm';
import type { RepositoriesSettings } from '@beyond-js/packages/repositories/settings';

export /*bundle*/ class Registries extends Map {
	#npm: NpmRegistry;
	get npm() {
		return this.#npm;
	}

	constructor(settings: RepositoriesSettings) {
		super();
		this.#npm = new NpmRegistry(settings);

		super.set('npm', this.#npm);
	}
}
