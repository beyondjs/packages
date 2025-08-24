import type { Conditional } from './conditional';
import type { OutputsType, IOutput } from '@beyond-js/packages/module';
import type { IDiagnostic } from '@beyond-js/packages/types';
import { DynamicProcessor } from '@beyond-js/dynamic-processor/main';

interface IDone {
	errors?: IDiagnostic[];
	updated?: Map<string, IOutput>;
}

export class Outputs extends DynamicProcessor(Map<string, IOutput>) implements OutputsType {
	get dp() {
		return 'exports-bundler.outputs';
	}

	#conditional: Conditional;

	#errors: IDiagnostic[] = [];
	get errors(): IDiagnostic[] {
		return this.#errors;
	}

	valid(): boolean {
		return !this.#errors.length;
	}

	constructor(conditional: Conditional) {
		super();
		this.#conditional = conditional;

		super.setup(new Map([['conditional', { child: conditional.spec }]]));
	}

	_process() {
		const errors: IDiagnostic[] = [];
		const updated: Map<string, IOutput> = new Map();

		const done = ({ errors, updated }: IDone) => {
			errors = errors || [];
			updated = updated || new Map();
		};

		console.log('Processing outputs for conditional', this.#conditional.spec.values);

		const { valid } = this.#conditional.spec;
		if (!valid) {
			const code = 'INVALID_CONDITIONAL_SPEC';
			errors.push({ code, message: 'Invalid conditional spec' });
			return done({ errors, updated });
		}

		return done({ updated });
	}
}
