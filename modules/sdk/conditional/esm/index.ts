import { Conditional } from '../main';
import { ConditionalOutput } from '@beyond-js/packages/module/output';

export /*bundle*/ abstract class ESMConditional extends Conditional {
	#output: ConditionalOutput;
	get output(): ConditionalOutput {
		return this.#output;
	}
}
