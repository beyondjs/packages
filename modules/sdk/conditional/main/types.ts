import type { Processors } from '../processors/base';

export /*bundle*/ interface IConditionalStrategy {
	// If Processors property is not defined, then the Processors class will be used as default
	Processors?: typeof Processors;
	outputs: {
		ESModule: string;
		LocalModule: string;
		Types: string;
		CSS: string;
	};
}

export /*bundle*/ interface ICompiledArtifact {
	source: string;
	issues: string[];
	code(output: CodeOutputType): string;
	map(format: MapType): string;
}
