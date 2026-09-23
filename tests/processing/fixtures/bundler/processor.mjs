/**
 * A processor whose build throws, as a defect of a real processor would
 */
import { ConditionalProcessor } from '@beyond-js/packages/sdk';

export class Processor extends ConditionalProcessor {
	constructor(conditional, name) {
		super(conditional, name, { sources: { inputs: { extname: ['.js'] } } });
	}

	async _build() {
		throw new Error('the build of the fixture processor throws');
	}
}
