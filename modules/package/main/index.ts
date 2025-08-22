import type { IDiagnostic, IPackageJSON } from '@beyond-js/packages/types';
import { WatcherClient } from '@beyond-js/watchers/client';
import { Config } from '@beyond-js/config/main';
import Attributes from './attributes';
import { Bundlers } from './bundlers';
import { Modules } from './modules';
// import Static from './static';
import { equal } from '@beyond-js/equal/main';

interface IOptions {
	watcher?: boolean;
}

interface IDone {
	changed: boolean;
	errors?: IDiagnostic[];
	warnings?: IDiagnostic[];
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

	#bundlers: Bundlers;
	get bundlers() {
		return this.#bundlers;
	}

	#modules: Modules;
	get modules() {
		return this.#modules;
	}

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
			static: config.properties.get('static')
		};

		this.#bundlers = new Bundlers(config);
		this.#modules = new Modules(this, config);
		// this.#static = new Static(this, cfg.static, this.#modules);
	}

	constructor(path: string, options: IOptions = {}) {
		const config = new Config(path, {
			'/bundlers': 'object',
			'/exports': 'object',
			'/static': 'object'
		});
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

		const done = ({ changed, errors, warnings }: IDone) => {
			errors = errors ? errors : [];
			warnings = warnings ? warnings : [];

			const previous = { errors: this.#errors, warnings: this.#warnings };
			changed = changed || equal(previous, { errors, warnings });
			if (!changed) return false;

			this.#errors = errors;
			this.#warnings = warnings;
			return true;
		};

		// Process the attributes of the package
		const config: IPackageJSON | {} = !valid || !value ? {} : value;
		const changed = super.process(config);
		if (!changed || !valid) return done({ changed });

		if (!this.name || !this.version) {
			const code = 'PACKAGE_NAME_VERSION_MISSING';
			const message = `The package.json file must contain the 'name' and 'version' properties.`;
			return done({ changed, errors: [{ code, message }] });
		}
	}

	destroy() {
		super.destroy();
		this.#watcher.destroy();
		// this.#bundlers.destroy();
		this.#modules.destroy();
		// this.#static.destroy();
	}
}
