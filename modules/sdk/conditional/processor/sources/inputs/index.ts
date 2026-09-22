import type { ConditionalProcessor } from '../..';
import type { IProcessorInputsStrategy } from '../../types';
import type { WatcherClient } from '@beyond-js/watchers/client';
import { FinderCollection } from '@beyond-js/finder/collection';
import { ProcessorInputsSpec } from './spec';
import { ProcessorInput } from './file';
import { Tests } from './tests';
import { join } from 'path';

/**
 * The source files a processor takes as input, found under the module directory and kept up to date.
 *
 * The collection is configured from the specification of the processor, so changing the selection in the
 * module manifest reconfigures it, and it watches the resulting directory when the package provides a
 * watcher client: added, removed and edited files then invalidate the processor that consumes them.
 */
export class ProcessorInputs extends FinderCollection {
	get dp() {
		return 'processor.inputs';
	}

	#processor: ConditionalProcessor;
	get processor() {
		return this.#processor;
	}

	#watcher: WatcherClient;

	/**
	 * The watcher client of the package, which the input files subscribe their own changes to.
	 * It is undefined when the package was created without watching.
	 */
	get watcher() {
		return this.#watcher;
	}

	#extname: string[];
	#spec: ProcessorInputsSpec;

	constructor(processor: ConditionalProcessor, strategy: IProcessorInputsStrategy) {
		const { watcher } = processor.conditional.module.package;
		super({ Item: ProcessorInput, watcher });

		this.#processor = processor;
		this.#watcher = watcher;
		this.#extname = typeof strategy.extname === 'string' ? [strategy.extname] : strategy.extname;

		const spec = new ProcessorInputsSpec(this.#processor);
		this.#spec = spec;
		super.setup(new Map([['spec', { child: spec }]]));

		spec.on('initialised', () => this._configure());
		spec.on('change', () => this._configure());
	}

	_configure() {
		if (!this.#spec.valid) {
			super.configure();
			return;
		}

		const { module } = this.#processor.conditional;
		const path = join(module.package.path, module.spec.path, this.#spec.values.path);
		const { includes, excludes, tests } = this.#spec.values;
		const extname = this.#extname;

		// Test files beside the sources are not inputs unless the specification includes them
		const filter = tests === 'included' ? void 0 : Tests.source;
		super.configure(path, { extname, includes, excludes, filter });
	}
}
