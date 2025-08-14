import type { IDiagnostic, IPackageJSON } from '@beyond-js/packages/types';
import { WatcherClient } from '@beyond-js/watchers/client';
import { Config } from '@beyond-js/config/main';
import Attributes from './attributes';
// import Bundlers from './bundlers';
// import Modules from './modules';
// import Static from './static';

interface IOptions {
	watcher?: boolean;
}

export /*bundle*/ class Package extends Attributes {
	#options: IOptions;

	#watcher: WatcherClient;
	get watcher() {
		return this.#watcher;
	}

	#errors: IDiagnostic[] = [];
	get errors() {
		return this.#errors;
	}

	#warnings: IDiagnostic[] = [];
	get warnings() {
		return this.#warnings;
	}

	get valid() {
		return !this.#errors.length;
	}

	// #bundlers: Bundlers;
	// get bundlers() {
	// 	return this.#bundlers;
	// }

	// #modules: Modules;
	// get modules() {
	// 	return this.#modules;
	// }

	// #static: Static;
	// get static() {
	// 	return this.#static;
	// }

	async _begin() {
		await super._begin();

		// Create the files watcher of the package
		const { config } = this;
		this.#watcher = this.#options.watcher && new WatcherClient('watchers', { is: 'package', path: config.path });
		this.#watcher?.start().catch((exc: Error) => console.error(exc.stack));

		const cfg = {
			bundlers: config.properties.get('bundlers'),
			static: config.properties.get('static'),
			modules: config.properties.get('modules')
		};

		// this.#bundlers = new Bundlers(this, cfg.bundlers);
		// this.#modules = new Modules(this, cfg.modules);
		// this.#static = new Static(this, cfg.static, this.#modules);
	}

	constructor(path: string, options: IOptions = {}) {
		const config = new Config(path, { '/bundlers': 'object', '/modules': 'object', '/static': 'object' });
		config.data = 'package.json';
		super(config);

		this.#options = options;

		// As the modules are subscribed to the events of the package, then
		// it is required to increase the number of listeners
		console.log('Uncomment: this.setMaxListeners(500);');
		// this.setMaxListeners(500);
	}

	_process() {
		const { warnings, errors, valid, value } = this.config;
		this.#warnings = warnings;
		this.#errors = errors;

		const config: IPackageJSON | {} = !valid || !value ? {} : value;
		super.process(config);
	}

	destroy() {
		super.destroy();
		this.#watcher.destroy();
		// this.#bundlers.destroy();
		// this.#modules.destroy();
		// this.#static.destroy();
	}
}
