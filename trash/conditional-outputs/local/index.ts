import { Output } from '@beyond-js/bundlers-sdk/conditional/output';
import { InternalModules } from '@beyond-js/bundlers-sdk/bundler/ims';

export class LocalOutput extends Output {
	get dp() {
		return 'bundler.output.local';
	}

	#ims;

	constructor(...args) {
		super(...args);
		this.#ims = new InternalModules(this.conditional.processors);
		super.setup(new Map([['ims', { child: this.#ims }]]));
	}
}
