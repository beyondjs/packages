import { DynamicProcessor } from '@beyond-js/dynamic-processor';

export default class ModuleStaticFiles extends DynamicProcessor(Map < string, {}) {
	#modules;

	constructor(modules) {
		super();

		this.#modules = modules;
		super.setup(new Map([['modules', { child: modules.resolvers.entries }]]));
	}

	_process() {
		// Process the list of static files from the module entries
	}
}
