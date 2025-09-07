import type { Conditional } from '../../main';
import { Processors } from '../base';

export class ProcessorsResolver extends Processors {
	get dp() {
		return 'bundler.processors.resolver';
	}

	constructor(conditional: Conditional) {
		super(conditional);

		super.setup(
			new Map([
				// Derived from the module spec: specified in the module.json file
				['conditional-spec', { child: conditional.spec }],
				// The module settings: specified in the package.json file (bundlers property)
				['bundler-settings', { child: conditional.module.bundler }]
			])
		);
	}

	_resolve(name: string) {
		const module = this.conditional.module;
		const settings = module.bundler.settings.values;

		let found = settings.processors[name];
		if (!found) {
			const code = 'PROCESSOR_NOT_FOUND';
			const message = `Processor "${name}" not found in the bundler settings`;
			return { error: { code, message } };
		}

		found = typeof found === 'string' ? { specifier: found } : found;
		if (typeof found !== 'object') {
			const code = 'INVALID_PROCESSOR';
			const message = `Processor "${name}" is invalid. An object or a string is expected`;
			return { error: { code, message } };
		}

		const { specifier } = found;
		if (typeof specifier !== 'string' || !specifier) {
			const code = 'INVALID_PROCESSOR_SPECIFIER';
			const message = `Processor "${name}" does not have a valid specifier`;
			return { error: { code, message } };
		}

		return { specifier };
	}
}
