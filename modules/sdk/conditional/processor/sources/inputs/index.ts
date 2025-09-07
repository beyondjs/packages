import type { Processor } from '../..';
import { ipc } from '@beyond-js/ipc/main';
import { FinderCollection } from '@beyond-js/finder/collection';
import { InputSource } from './source';
import { ProcessorInputsSpec } from './spec';
import { join } from 'path';

export class ProcessorSourcesInputs extends FinderCollection {
	#processor;
	get processor() {
		return this.#processor;
	}

	get ready() {
		return Promise.all([this.#spec.ready, super.ready]);
	}

	#extname;
	#spec;

	constructor(processor: Processor, strategy) {
		const { watcher } = processor.conditional.module.package;

		const Source = strategy.Source || InputSource;
		super(watcher, Source, { items: { subscriptions: ['change'] } });

		this.#processor = processor;
		this.#extname = strategy.extname;

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

	_notify() {
		let table = 'processors-sources';
		let {
			application,
			bundle: { id }
		} = this.#processor.spec;
		id = id.split('//').pop();
		id.includes('template.') && (table = `${id.replace('.', '-')}-sources`);

		ipc.notify('data-notification', {
			type: 'list/update',
			table: table,
			filter: { application: application.id }
		});
	}
}
