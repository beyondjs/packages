import { BackgroundWatcher } from '@beyond-js/watchers/client';
import Bundlers from './bundlers';
import Modules from './modules';
import Static from './static';
import Attributes from './attributes';

interface IError {
	code: string;
	message: string;
	stack?: string;
}
interface IWarning {
	code: string;
	message: string;
	stack?: string;
}
interface IOptions {
	watcher?: boolean;
}

export /*bundle*/ class Package extends Attributes {
	#options: IOptions;

	#watcher: BackgroundWatcher;
	get watcher() {
		return this.#watcher;
	}

	#errors: IError[] = [];
	get errors() {
		return this.#errors;
	}

	#warnings: IWarning[] = [];
	get warnings() {
		return this.#warnings;
	}

	get valid() {
		return !this.#errors.length;
	}

	#bundlers: Bundlers;
	get bundlers() {
		return this.#bundlers;
	}

	#modules: Modules;
	get modules() {
		return this.#modules;
	}

	#static: Static;
	get static() {
		return this.#static;
	}

	async _begin() {
		await super._begin();

		// Create the files watcher of the package
		const { config } = this;
		this.#watcher = this.#options.watcher && new BackgroundWatcher({ is: 'package', path: config.path });
		this.#watcher?.start().catch((exc: Error) => console.error(exc.stack));

		const cfg = {
			bundlers: config.properties.get('bundlers'),
			static: config.properties.get('static'),
			modules: config.properties.get('modules')
		};

		this.#bundlers = new Bundlers(this, cfg.bundlers);
		this.#modules = new Modules(this, cfg.modules);
		this.#static = new Static(this, cfg.static, this.#modules);
	}

	constructor(path: string, options: IOptions = {}) {
		const config = new Config(path);
		super(config);

		this.#options = options;

		// As the modules are subscribed to the events of the package, then
		// it is required to increase the number of listeners
		this._events.setMaxListeners(500);
	}

	_process() {
		const { warnings, errors, valid, value } = this.config;
		this.#warnings = warnings;
		this.#errors = errors;

		const config = !valid || !value ? {} : value;
		super._process(config);
	}

	destroy() {
		super.destroy();
		this.#watcher.destroy();
		this.#bundlers.destroy();
		this.#modules.destroy();
		this.#static.destroy();
	}
}
