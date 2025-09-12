import type { ConditionalProcessor } from '../..';
import type { IProcessorInputsStrategy } from '../../types';
import { FinderCollection } from '@beyond-js/finder/collection';
import { ProcessorInputsSpec } from './spec';
import { join } from 'path';

export class ProcessorInputs extends FinderCollection {
	get dp() {
		return 'processor.inputs';
	}

	#processor: ConditionalProcessor;
	get processor() {
		return this.#processor;
	}

	#extname: string[];
	#spec: ProcessorInputsSpec;

	constructor(processor: ConditionalProcessor, strategy: IProcessorInputsStrategy) {
		const { watcher } = processor.conditional.module.package;
		super({ watcher });

		this.#processor = processor;
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

		const path = join(this.#processor.conditional.module.spec.path, this.#spec.values.path);
		const { includes, excludes } = this.#spec.values;
		const extname = this.#extname;
		super.configure(path, { extname, includes, excludes });
	}
}
