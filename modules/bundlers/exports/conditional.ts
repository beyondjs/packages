import type { IProcessedSpec } from '@beyond-js/packages/module';
import type { ExportsType, ExportsTargetType } from '@beyond-js/packages/types';
import { BaseConditional } from '@beyond-js/packages/module';
import { Outputs } from './outputs';

export /*bundle*/ class Conditional extends BaseConditional {
	#outputs: Outputs;
	get outputs(): Outputs {
		return this.#outputs;
	}

	constructor(...args: ConstructorParameters<typeof BaseConditional>) {
		super(...args);
		this.#outputs = new Outputs(this);
	}

	_spec(spec: ExportsType): IProcessedSpec {
		const values = (<any>spec).node.require;
		return { values };
	}
}
