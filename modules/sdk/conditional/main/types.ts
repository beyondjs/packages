import type { Processors } from '../processors/base';

export /*bundle*/ interface IConditionalStrategy {
	// If Processors property is not defined, then the Processors class will be used as default
	Processors?: typeof Processors;
}
