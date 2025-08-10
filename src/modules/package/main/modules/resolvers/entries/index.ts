import type { Config } from '@beyond-js/config/main';
import { Package } from '../../..';
import { FinderCollection } from '@beyond-js/finder/collection';
import Entry from './entry';

/**
 * Collection of modules of the package
 */
export default class ModulesEntries extends FinderCollection<Entry> {
	#package: Package;
	get package() {
		return this.#package;
	}

	#config;
	get config() {
		return this.#config;
	}

	get path() {
		return this.#config.path;
	}

	constructor(pkg: Package, config: Config) {
		super(pkg.watcher, Entry, { items: { subscriptions: ['change'] } });
		this.#config = config;

		config.on('initialised', this.#configure);
		config.on('change', this.#configure);
		config.initialised && this.#configure();
	}

	#initialising = false;
	get initialising() {
		return this.#initialising || super.initialising;
	}

	async initialise() {
		if (this.initialised || this.#initialising) return;
		this.#initialising = true;

		// Create the files watcher of the package
		const config = this.#config;
		!config.initialised && (await config.initialise());

		await super.initialise();
		this.#initialising = false;
	}

	#configure = () => {
		const config = this.#config;
		if (!config.valid || !config.value) {
			super.configure();
			return;
		}

		super.configure(config.path, { filename: 'module.json', excludes: ['./builds', 'node_modules'] });
	};

	destroy() {
		super.destroy();
		this.#config.off('initialised', this.#configure);
		this.#config.off('change', this.#configure);
	}
}
