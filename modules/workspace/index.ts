import { DynamicProcessor } from '@beyond-js/dynamic-processor/main';
import { Config } from '@beyond-js/config/main';
import { Package } from '@beyond-js/packages/package';

export /*bundle*/ class Workspace extends DynamicProcessor() {
	#path: string;
	get path() {
		return this.#path;
	}

	#config: Config;

	#packages: Map<string, Package> = new Map();
	get packages() {
		return this.#packages;
	}

	constructor(path = process.cwd()) {
		super();

		this.#path = path;
		const config = new Config(path);
		this.#config = config;

		config.data = 'beyond.json';
		super.setup(new Map([['config', { child: config }]]));
	}

	_process() {}
}
