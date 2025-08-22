const ipc = require('@beyond-js/ipc/main');
const { FinderCollection } = require('@beyond-js/finder');
const InputSource = require('./source');
const Specs = require('./specs');
const { join } = require('path');

module.exports = class extends FinderCollection {
	#processor;
	get processor() {
		return this.#processor;
	}

	get ready() {
		return Promise.all([this.#specs.ready, super.ready]);
	}

	#extname;
	#specs;

	constructor(processor, strategy) {
		const { watcher } = processor.conditional.module.package;

		const Source = strategy.Source || InputSource;
		super(watcher, Source, { items: { subscriptions: ['change'] } });

		this.#processor = processor;
		this.#extname = strategy.extname;

		const specs = new Specs(this.#processor);
		this.#specs = specs;
		super.setup(new Map([['specs', { child: specs }]]));

		specs.on('initialised', () => this._configure());
		specs.on('change', () => this._configure());
	}

	_configure() {
		if (!this.#specs.valid) {
			super.configure();
			return;
		}

		const path = join(this.#processor.conditional.module.path.dirname, this.#specs.values.path);
		const { includes, excludes } = this.#specs.values;
		const extname = this.#extname;
		super.configure(path, { extname, includes, excludes });
	}

	_notify() {
		let table = 'processors-sources';
		let {
			application,
			bundle: { id }
		} = this.#processor.specs;
		id = id.split('//').pop();
		id.includes('template.') && (table = `${id.replace('.', '-')}-sources`);

		ipc.notify('data-notification', {
			type: 'list/update',
			table: table,
			filter: { application: application.id }
		});
	}
};
