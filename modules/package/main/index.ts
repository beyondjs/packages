import type { IDiagnostic, IPackageManifest } from '@beyond-js/packages/types';
import { WatcherClient } from '@beyond-js/watchers/client';
import { Config } from '@beyond-js/config/main';
import Attributes from './attributes';
import { Bundlers } from './bundlers';
import { PackageController } from './controller';
import { Modules } from './modules';
import { equal } from '@beyond-js/equal/main';
// import Static from './static';

interface IOptions {
	watcher?: boolean;

	/**
	 * The workspace the package belongs to, which resolves the public specifiers of its siblings
	 */
	workspace?: { resolve(specifier: string): { package: Package; subpath: string } | undefined };
}

interface IDone {
	changed: boolean;
	errors?: IDiagnostic[];
	warnings?: IDiagnostic[];
}

export /*bundle*/ class Package extends Attributes {
	#path: string;
	get path() {
		return this.#path;
	}

	#options: IOptions;

	/**
	 * The workspace the package was created by, when it was created by one. It is how a processor of the
	 * package resolves a public specifier of a sibling package, such as the declaration of its types.
	 */
	get workspace() {
		return this.#options.workspace;
	}

	#watcher: WatcherClient;
	get watcher() {
		return this.#watcher;
	}

	#controller: PackageController;

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

	/**
	 * The bundler that compiles the public modules of this package that do not select one, named as it is
	 * registered in its `bundlers` and configured as `beyond.bundler`.
	 *
	 * It lets a package declare its compiler once instead of repeating it in every module manifest, so a
	 * module manifest is only needed when a module configures its own build.
	 */
	get defaultBundler(): string | undefined {
		const beyond = this.manifest?.beyond;
		return typeof beyond === 'object' && beyond && typeof beyond.bundler === 'string' ? beyond.bundler : void 0;
	}

	// #static: Static;
	// get static() {
	// 	return this.#static;
	// }

	async _begin() {
		await super._begin();

		// Create the files watcher of the package
		const { config } = this;
		this.#watcher = this.#options.watcher ? new WatcherClient('watchers', { is: 'package', path: config.path }) : void 0;
		this.#watcher?.start().catch((exc: Error) => console.error(exc.stack));

		const cfg = {
			bundlers: config.properties.get('bundlers'),
			static: config.properties.get('static')
		};

		this.#bundlers = new Bundlers(config);
		this.#controller = new PackageController(this);
		this.#modules = new Modules(this, config);
		// this.#static = new Static(this, cfg.static, this.#modules);
	}

	constructor(path: string, options: IOptions = {}) {
		const config = new Config(path, {
			'/bundlers': 'object',
			'/static': 'object'
		});
		config.data = 'package.json';
		super(config);

		this.#path = path;
		this.#options = options;

		// As the modules are subscribed to the events of the package, then
		// it is required to increase the number of listeners
		console.log('Uncomment: this.setMaxListeners(500);');
		// this.setMaxListeners(500);
	}

	_process() {
		const done = ({ changed, errors, warnings }: IDone) => {
			errors = errors ? errors : [];
			warnings = warnings ? warnings : [];

			const previous = { errors: this.#errors, warnings: this.#warnings };
			changed = changed || !equal(previous, { errors, warnings });
			if (!changed) return false;

			this.#errors = errors;
			this.#warnings = warnings;
			return true;
		};

		// Process the attributes of the package
		const { warnings, errors, valid, value } = this.config;
		const config: IPackageManifest | {} = !valid || !value ? {} : value;

		const changed = super.process(config);
		if (!changed || !valid) return done({ changed, errors, warnings });

		if (!this.name || !this.version) {
			const code = 'PACKAGE_NAME_VERSION_MISSING';
			const message = `The package.json file must contain the 'name' and 'version' properties.`;
			return done({ changed, errors: [{ code, message }], warnings });
		}
	}

	destroy() {
		super.destroy();
		this.#watcher?.destroy();
		this.#bundlers?.destroy();
		this.#modules?.destroy();
		// this.#static.destroy();
	}
}
