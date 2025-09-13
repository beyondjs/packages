import type { ProcessorSettings } from './settings';
import type { ProcessorSpec } from './spec';
import type { ProcessorSources } from './sources';
import type { ProcessorInputs } from './sources/inputs';
import type { DynamicFile } from '@beyond-js/file/dynamic';

export /*bundle*/ interface IProcessorStrategy {
	// If Spec is not specified, then the ProcessorSettings will be used as default
	Spec?: typeof ProcessorSpec;
	// If Settings is not specified, then the ProcessorSettings will be used as default
	Settings?: typeof ProcessorSettings;
	delegates: string[];
	sources: IProcessorSourcesStrategy;
}

export /*bundle*/ interface IProcessorSourcesStrategy {
	Sources: typeof ProcessorSources;
	inputs: IProcessorInputsStrategy;
	files?: IProcessorSourcesFileStrategy[];
}

export /*bundle*/ interface IProcessorInputsStrategy {
	Inputs: typeof ProcessorInputs;
	extname: string[] | string;
}

export /*bundle*/ interface IProcessorSourcesFileStrategy {
	File?: typeof DynamicFile;
	// When true, File uses DynamicFileObject instead of DynamicFile
	// Discarded when File is specified
	json?: boolean;
	file: string;
}
